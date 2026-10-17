/**
 * Recurring Capture Planner (Convert-To-Recurring Phase 1) — what a recurring sync does with each
 * Plaid stream under the new capture rules. PURE: the orchestrator loads, this decides, repos write.
 *
 * It only ever changes behavior for (a) records stamped v2 and (b) NEW streams while the user's
 * flag is on. A record that existed without the stamp is passed through exactly as today (D13).
 *
 * Per stream:
 *   - OLD record (no stamp)   → saved as today; stale-marked as today.
 *   - v2 record               → ALWAYS saved (X10, whatever Plaid's status / frequency says);
 *                               `is_active` stays OURS, Plaid's flag goes to `plaid_is_active`;
 *                               a shown bill that CHANGES to Plaid-inactive opens "Still a bill?"
 *                               (X2, D5); back to active closes it. Never stale-marked: a v2 bill
 *                               Plaid stops returning is asked about instead (D19), a rejected one
 *                               is left alone (gap 8).
 *   - NEW stream, flag off    → today's handling (saved, unstamped).
 *   - NEW stream, flag on:
 *       first seen inactive   → today's handling (X2: no active bill, no question);
 *       tombstoned            → skipped (D17);
 *       answered "track" / "keep separate" → created v2 (with the picked schedule, D8);
 *       vendor "Not a bill"   → skipped (X14: a maturing stream checks dismissals);
 *       low confidence        → no record; one `suggested` item per vendor (D6/D8, X14) when the
 *                               stream may be suggested at all (no transfers; income gates, X17);
 *       mature                → created v2 (stamped at creation, X1).
 * Every NEW stream not saved has its Plaid transaction ids held out of fuzzy bill matching (X3)
 * — they're normal transactions, never linked to an old bill by a merchant guess.
 *
 * @module domain/recurring/recurring_capture_planner
 */

import type {
  InflowForPersistence,
  OutflowForPersistence,
} from "../../integrations/plaid/plaid_recurring_transformer";
import { vendor_key } from "../transactions/vendor_key.service";
import {
  CAPTURE_RULES_VERSION,
  is_card_payment_inflow,
  is_low_confidence_stream,
  is_tombstoned_stream,
  may_suggest_stream,
} from "./capture_rules";
import {
  PENDING_HANDOFF_TTL_MS,
  PENDING_TRACK_MAX_AGE_MS,
  PendingTrack,
  RecurringReviewState,
  ReviewDirection,
  ReviewItem,
  ReviewStateChange,
  build_review_item_id,
  is_user_answered,
  is_vendor_dismissed,
  make_review_item,
  resolve_review_item,
  suggested_subject,
} from "./review_item.service";
import { is_currently_suppressed, RemovalInterval } from "./recurring_suppression.service";
import { find_replaced_record } from "./same_bill.service";
import type { AbsorbedStream } from "./convert_recurring.service";
import { AbsorbWrite, find_absorber, plan_absorb } from "./absorb.service";

/** A stored record as the planner sees it (see `CaptureRecordInfo` in the sync resolver). */
export interface PlannerRecord {
  id: string;
  direction: ReviewDirection;
  is_active: boolean;
  is_hidden: boolean;
  v2: boolean;
  plaid_is_active: boolean | null;
  plaid_inactive_ack_ms: number | null;
  merged_into_id: string | null;
  account_id: string;
  plaid_item_id: string;
  source: string;
  name: string;
  merchant_name: string | null;
  description: string | null;
  average_amount: number;
  frequency: string;
  plaid_status: string;
  plaid_detailed_category: string;
  first_date_ms: number;
  last_date_ms: number;
  removal_intervals: Array<{ from_ms: number; to_ms: number | null; mode: string }>;
  transaction_ids: string[];
  /** The user's own name for it (wins over Plaid's merchant / description in `name`). */
  custom_name?: string | null;
  // Convert-To-Recurring Phase 2 (absent on every record that predates it).
  vendor_key?: string | null;
  expected_amount_override?: number | null;
  user_frequency?: string | null;
  absorbed_streams?: AbsorbedStream[];
  absorbed_txn_ids?: string[];
}

/** One Plaid stream of the response (identified; on an active account). */
export interface PlannerStream {
  direction: ReviewDirection;
  stream_id: string;
  /** The transformed entity, or null when it failed validation (rejected). */
  entity: OutflowForPersistence | InflowForPersistence | null;
  raw_status: string;
  raw_frequency: string;
  raw_is_active: boolean;
  account_id: string;
  account_type: string | null;
  merchant_name: string | null;
  description: string | null;
  detailed_category: string;
  transaction_ids: string[];
  average_amount: number;
  predicted_next_ms: number | null;
  /** Plaid's first payment date of the stream (ms; 0 when unknown). */
  first_date_ms: number;
}

export interface CapturePlanInput {
  user_id: string;
  plaid_item_doc_id: string;
  now_ms: number;
  flag_on: boolean;
  streams: PlannerStream[];
  /** Stored records for the response's stream ids (ANY state). */
  existing: Map<string, PlannerRecord>;
  /** Today's stale candidates (this item's active records not among the VALID stream ids). */
  stale_candidates: PlannerRecord[];
  review_items: Map<string, ReviewItem>;
  state: RecurringReviewState | null;
  /**
   * Same-bill candidates beyond this response's own records (D7): the user's active records, and
   * — once loaded lazily (X9) — their inactive ones, with the user's active account ids (an
   * account-removal soft delete is never "stopped").
   */
  same_bill?: {
    candidates: PlannerRecord[];
    active_account_ids: Set<string>;
    inactive_loaded: boolean;
  };
  /**
   * The user's OTHER active Plaid items (round 4 defect 2) — loaded only when the plan asks
   * (`wants_other_items`): a track whose stream is gone from this item is handed to them rather
   * than lost. Undefined = not loaded.
   */
  other_item_doc_ids?: string[];
}

export interface CapturePlan {
  save_outflows: OutflowForPersistence[];
  save_inflows: InflowForPersistence[];
  /** Mark stale exactly as today (old records only). */
  stale_outflow_ids: string[];
  stale_inflow_ids: string[];
  /** v2 records Plaid stopped returning → `plaidIsActive=false` (+ "Still a bill?"). */
  plaid_inactive_outflow_ids: string[];
  plaid_inactive_inflow_ids: string[];
  /** Every item this sync wants to exist, at its current content (caller writes changed ones). */
  review_items: ReviewItem[];
  state_change: ReviewStateChange;
  /** A new v2 stream found no same-bill candidate among the loaded records: load the user's
   *  inactive records and plan again (X9 — lazy, ≈ never in steady state). */
  wants_inactive_records?: boolean;
  /** The state change that doesn't depend on any save (held-out ids of streams not saved, …). */
  base_change?: BaseChange;
  /** What each save brings with it (released ids, closed items) — dropped when its save fails
   *  (review round 3 defect 3). `state_change` = base_change + every effect. */
  save_effects?: SaveEffect[];
  /** A track's stream is gone from this item and no other stream / bill of its vendor is known:
   *  load the user's other Plaid items and plan again (round 4 defect 2 — ≈ never). */
  wants_other_items?: boolean;
  /** Other Plaid items a track was just handed to: the caller re-syncs them now. */
  handoff_item_doc_ids?: string[];
  /** Converted records that absorb a stream this sync (D42): one stamped write each. */
  absorbs?: AbsorbWrite[];
}

/** The state / item changes that follow from saving one stream's record. */
export interface SaveEffect {
  direction: ReviewDirection;
  stream_id: string;
  /** Held-out ids released because this stream's record now exists. */
  release: string[];
  /** Review items closed because of this save (e.g. "matured"). */
  item_ids: string[];
  /** Pending tracks this save fulfils (defect 4). */
  remove_pending: string[];
}

/** The part of a plan's state change that doesn't depend on a save. */
export interface BaseChange {
  add_suppressed: string[];
  remove_suppressed: string[];
  remove_pending_track_ids: string[];
  /** Pending tracks replaced in place (handed off / one fewer item awaited — defect 2). */
  add_pending_tracks?: PendingTrack[];
  /** This Plaid item's open suggested tiles, when they changed (defect 2). */
  set_suggested_owners?: { plaid_item_doc_id: string; item_ids: string[] };
  /** Round 5: the user's live Plaid items, when loaded and an owner entry names another one. */
  keep_owner_item_doc_ids?: string[];
}

/** base + effects → the state change; ids both held out and released end released (stream
 *  membership wins). PURE. */
export function compose_state_change(base: BaseChange, effects: SaveEffect[]): ReviewStateChange {
  const remove = new Set<string>([...base.remove_suppressed, ...effects.flatMap((e) => e.release)]);
  const pending = [...new Set([...base.remove_pending_track_ids, ...effects.flatMap((e) => e.remove_pending)])];
  const removed_pending = new Set(pending);
  const add_pending = (base.add_pending_tracks ?? []).filter((p) => !removed_pending.has(p.item_id));
  return {
    add_suppressed: [...new Set(base.add_suppressed)].filter((id) => !remove.has(id)),
    remove_suppressed: [...remove],
    ...(pending.length > 0 ? { remove_pending_track_ids: pending } : {}),
    ...(add_pending.length > 0 ? { add_pending_tracks: add_pending } : {}),
    ...(base.set_suggested_owners ? { set_suggested_owners: base.set_suggested_owners } : {}),
    ...(base.keep_owner_item_doc_ids ? { keep_owner_item_doc_ids: base.keep_owner_item_doc_ids } : {}),
  };
}

/**
 * A save batch failed for these directions: nothing that depended on those saves may land — the
 * held-out ids stay held, the items they would have closed stay as they are, so the next sync
 * (which sees no record yet) does it all again (review round 3 defect 3). PURE.
 */
export function drop_failed_saves(plan: CapturePlan, failed: Set<ReviewDirection>): CapturePlan {
  if (failed.size === 0 || !plan.save_effects || !plan.base_change) return plan;
  const ok = plan.save_effects.filter((e) => !failed.has(e.direction));
  const dropped_items = new Set(plan.save_effects.filter((e) => failed.has(e.direction)).flatMap((e) => e.item_ids));
  return {
    ...plan,
    save_effects: ok,
    state_change: compose_state_change(plan.base_change, ok),
    review_items: plan.review_items.filter((i) => !dropped_items.has(i.id)),
  };
}

/** The review-item ids a sync must look up for this response (X8: getAll, no query). */
export function review_ids_for_sync(
  user_id: string,
  streams: PlannerStream[],
  records: PlannerRecord[],
  /** Streams a converted record already absorbed: they never get a tile or a question, so their
   *  two item ids are not looked up on every sync (a missing doc is still billed). */
  absorbed_stream_ids: ReadonlySet<string> = new Set()
): string[] {
  const ids = new Set<string>();
  const has_record = new Set(records.map((r) => r.id));
  for (const s of streams) {
    if (has_record.has(s.stream_id)) continue; // suggested / same-bill only apply to NEW streams
    if (absorbed_stream_ids.has(s.stream_id)) continue;
    ids.add(build_review_item_id(user_id, "suggested", suggested_subject(s.direction, stream_vendor(s))));
    ids.add(build_review_item_id(user_id, "same_bill", s.stream_id));
  }
  // A "Still a bill?" item can exist only for a v2 record Plaid has (or now reports) off, or that
  // Plaid stopped returning — every other v2 record needs no lookup.
  const raw_active = new Map(streams.map((s) => [s.stream_id, s.raw_is_active]));
  for (const r of records) {
    if (!r.v2) continue;
    const in_response = raw_active.has(r.id);
    if (r.plaid_is_active === false || !in_response || raw_active.get(r.id) === false) {
      ids.add(build_review_item_id(user_id, "still_a_bill", r.id));
    }
  }
  return [...ids];
}

/**
 * The vendor key a stream is suggested under; a stream with no merchant / description falls back
 * to its stream id under an UPPER-CASE prefix. Real vendor keys are always lower-cased
 * (`vendor_key_from_name`), so the fallback can never collide with a vendor — not even one named
 * "stream:<id>" (it used `stream:<id>`, which such a merchant would produce; extra test).
 */
export const STREAM_VENDOR_PREFIX = "STREAM:";
export function stream_vendor(s: { merchant_name: string | null; description: string | null; stream_id: string }): string {
  return vendor_key({ merchant_name: s.merchant_name, name: s.description }) ?? `${STREAM_VENDOR_PREFIX}${s.stream_id}`;
}


const app_frequency = (raw: string): string | null => {
  switch (String(raw).toUpperCase()) {
    case "WEEKLY": return "weekly";
    case "BIWEEKLY": return "biweekly";
    case "SEMI_MONTHLY": return "semimonthly";
    case "MONTHLY": return "monthly";
    case "ANNUALLY": return "yearly";
    default: return null;
  }
};

/**
 * The record as it will be AFTER this sync saves the stream's entity: a question built from the
 * pre-save record changed again on the next identical sync (one extra item write each time Plaid
 * changed a field — found by the planner property test, Top-25 #23).
 */
function as_saved(ex: PlannerRecord, s: PlannerStream, saved: OutflowForPersistence | InflowForPersistence): PlannerRecord {
  const merchant =
    s.direction === "outflow"
      ? (saved as OutflowForPersistence).merchant_name ?? null
      : (saved as InflowForPersistence).payer_name ?? null;
  return {
    ...ex,
    merchant_name: merchant,
    description: saved.description ?? null,
    name: ex.custom_name || merchant || saved.description || (s.direction === "outflow" ? "Bill" : "Income"),
    average_amount: saved.average_amount,
    frequency: saved.frequency,
    plaid_status: saved.plaid_status,
    plaid_detailed_category: saved.plaid_detailed_category,
    account_id: saved.account_id,
  };
}

/**
 * A "Still a bill?" the system closed only because the bill went out of sight (its account was
 * removed, or the user removed / paused it) is asked again once the bill is back in sight and
 * Plaid still has it off — otherwise restoring the account (or the bill) silently drops the
 * question (Top-25 #16). Never one the user answered (that is `is_user_answered`).
 */
const reopens = (item: ReviewItem | undefined): boolean =>
  !!item && item.status !== "open" && (item.answer === "account_removed" || item.answer === "not_shown");

/** Is the record a bill the user currently sees (active, not hidden, not removed, not merged)? */
function is_shown(r: PlannerRecord, now_ms: number): boolean {
  return (
    r.is_active &&
    !r.is_hidden &&
    !r.merged_into_id &&
    !is_currently_suppressed(r.removal_intervals as RemovalInterval[], now_ms)
  );
}

function still_a_bill_item(
  input: CapturePlanInput,
  r: PlannerRecord,
  existing: ReviewItem | undefined
): ReviewItem {
  return make_review_item(
    {
      user_id: input.user_id,
      kind: "still_a_bill",
      direction: r.direction,
      source: "plaid",
      status: "open",
      answer: null,
      subject_key: r.id,
      vendor_key: vendor_key({ merchant_name: r.merchant_name, name: r.description }),
      account_id: r.account_id,
      plaid_item_doc_id: input.plaid_item_doc_id,
      stream_id: r.id,
      record_id: r.id,
      name: r.name,
      amount: r.average_amount,
      frequency: r.frequency,
      plaid_status: r.plaid_status,
      category: r.plaid_detailed_category,
      transaction_ids: [],
      next_due_ms: null,
      user_frequency: null,
      resolved_at_ms: null,
    },
    input.now_ms,
    existing
  );
}

function suggested_item(
  input: CapturePlanInput,
  s: PlannerStream,
  existing: ReviewItem | undefined
): ReviewItem {
  const vk = stream_vendor(s);
  return make_review_item(
    {
      user_id: input.user_id,
      kind: "suggested",
      direction: s.direction,
      source: "plaid",
      status: "open",
      answer: null,
      subject_key: suggested_subject(s.direction, vk),
      vendor_key: vk,
      account_id: s.account_id,
      plaid_item_doc_id: input.plaid_item_doc_id,
      stream_id: s.stream_id,
      record_id: null,
      name: s.merchant_name || s.description || (s.direction === "outflow" ? "Bill" : "Income"),
      amount: Math.abs(s.average_amount),
      frequency: app_frequency(s.raw_frequency),
      plaid_status: String(s.raw_status ?? "UNKNOWN").toUpperCase(),
      category: s.detailed_category,
      transaction_ids: s.transaction_ids,
      next_due_ms: s.predicted_next_ms,
      user_frequency: null,
      resolved_at_ms: null,
    },
    input.now_ms,
    existing
  );
}

function same_bill_item(
  input: CapturePlanInput,
  s: PlannerStream,
  old: PlannerRecord,
  existing: ReviewItem | undefined
): ReviewItem {
  return make_review_item(
    {
      user_id: input.user_id,
      kind: "same_bill",
      direction: s.direction,
      source: "plaid",
      status: "open",
      answer: null,
      subject_key: s.stream_id,
      vendor_key: stream_vendor(s),
      account_id: s.account_id,
      plaid_item_doc_id: input.plaid_item_doc_id,
      stream_id: s.stream_id,
      record_id: old.id,
      // "Looks like <the bill you know> changed. Same bill?"
      name: old.name,
      amount: Math.abs(s.average_amount),
      frequency: app_frequency(s.raw_frequency),
      plaid_status: String(s.raw_status ?? "UNKNOWN").toUpperCase(),
      category: s.detailed_category,
      transaction_ids: s.transaction_ids,
      next_due_ms: s.predicted_next_ms,
      user_frequency: null,
      resolved_at_ms: null,
    },
    input.now_ms,
    existing
  );
}

/** A low-confidence stream that may become its vendor's suggested tile (defect 2). */
interface SuggestCandidate {
  s: PlannerStream;
  subject: string;
  existing: ReviewItem | undefined;
}

/** Plan one recurring sync under the capture rules. PURE. */
export function plan_recurring_capture(input: CapturePlanInput): CapturePlan {
  const plan: CapturePlan = {
    save_outflows: [],
    save_inflows: [],
    stale_outflow_ids: [],
    stale_inflow_ids: [],
    plaid_inactive_outflow_ids: [],
    plaid_inactive_inflow_ids: [],
    review_items: [],
    state_change: { add_suppressed: [], remove_suppressed: [] },
  };
  // Every saved stream releases its own ids: a saved stream's payments are never held out
  // (stream membership wins — this is also what frees a track saved UNSTAMPED, defect 4).
  const save = (s: PlannerStream, e: OutflowForPersistence | InflowForPersistence, v2 = false) => {
    if (s.direction === "outflow") plan.save_outflows.push(e as OutflowForPersistence);
    else plan.save_inflows.push(e as InflowForPersistence);
    saved_ids.add(s.stream_id);
    const subject = suggested_subject(s.direction, stream_vendor(s));
    if (v2 && !saved_by_subject.has(subject)) saved_by_subject.set(subject, s);
    effect(s).release.push(...s.transaction_ids);
  };
  const saved_ids = new Set<string>();
  /** The first stream of each (direction, vendor) saved as a v2 bill this round — fulfils that
   *  vendor's tracks whose own stream is gone (defect 2). An OLD bill of the vendor never does. */
  const saved_by_subject = new Map<string, PlannerStream>();
  const item_at = (kind: ReviewItem["kind"], subject: string) =>
    input.review_items.get(build_review_item_id(input.user_id, kind, subject));
  const suggest_candidates: SuggestCandidate[] = [];
  const in_response_stream_ids = new Set(input.streams.map((x) => x.stream_id));
  const absorb_writes = new Map<string, AbsorbWrite>();
  const matured = new Map<string, { item: ReviewItem; s: PlannerStream }>();
  const base_change: BaseChange = { add_suppressed: [], remove_suppressed: [], remove_pending_track_ids: [] };
  const effects = new Map<string, SaveEffect>();
  const effect = (s: PlannerStream): SaveEffect => {
    let e = effects.get(s.stream_id);
    if (!e) {
      e = { direction: s.direction, stream_id: s.stream_id, release: [], item_ids: [], remove_pending: [] };
      effects.set(s.stream_id, e);
    }
    return e;
  };
  const suppress = (ids: string[]) => base_change.add_suppressed.push(...ids);

  // Same-bill pool + "stopped in this sync" (returned inactive, or a stale candidate).
  const pool_by_id = new Map<string, PlannerRecord>();
  for (const r of [...(input.same_bill?.candidates ?? []), ...input.existing.values()]) pool_by_id.set(r.id, r);
  const same_bill_pool = [...pool_by_id.values()];
  const stopped_in_sync = new Set<string>([
    ...input.streams.filter((x) => x.raw_is_active === false && input.existing.has(x.stream_id)).map((x) => x.stream_id),
    ...input.stale_candidates.map((r) => r.id),
  ]);
  const same_bill_ctx = {
    active_account_ids: input.same_bill?.active_account_ids ?? new Set<string>(),
    stopped_in_sync,
  };

  // This item's pending "Track" / "Keep separate" answers by their stream (round 4 test 7): the
  // stream is tracked by ID, so a vendor rename (merchant renamed → a new vendor key, a new tile)
  // still creates the bill the user asked for instead of leaving the track pending forever.
  const pending_by_stream = new Map<string, ReviewItem>();
  for (const pt of input.state?.pending_tracks ?? []) {
    if (pt.plaid_item_doc_id !== input.plaid_item_doc_id || !pt.stream_id || typeof pt.handed_off_ms === "number") continue;
    const it = input.review_items.get(pt.item_id);
    if (it && it.status === "resolved" && (it.answer === "track" || it.answer === "keep_separate" || it.answer === "same_bill")) pending_by_stream.set(pt.stream_id, it);
  }

  for (const s of input.streams) {
    const ex = input.existing.get(s.stream_id);

    // ── Existing OLD record: today's path, untouched.
    if (ex && !ex.v2) {
      if (s.entity) save(s, s.entity);
      continue;
    }

    // ── Existing v2 record: always kept, ours to turn on and off.
    if (ex && ex.v2) {
      if (!s.entity) continue; // rejected: not saved (invalid), never stale-marked (X10)
      const unknown_freq = is_low_confidence_stream("MATURE", s.raw_frequency);
      const saved_entity = {
        ...s.entity,
        is_active: ex.is_active,
        plaid_is_active: s.raw_is_active,
        // An UNKNOWN frequency would be invented as monthly by the transformer: keep ours.
        ...(unknown_freq ? { frequency: ex.frequency as OutflowForPersistence["frequency"] } : {}),
      } as OutflowForPersistence | InflowForPersistence;
      save(s, saved_entity, true);
      const cur = as_saved(ex, s, saved_entity);
      const open = item_at("still_a_bill", ex.id);
      if (open?.status === "open" && !is_shown(ex, input.now_ms)) {
        // The user removed / paused / merged the bill meanwhile: the question is moot — closed,
        // never refreshed (defect 5; no tile for a bill that isn't shown).
        plan.review_items.push(resolve_review_item(open, "not_shown", input.now_ms));
      } else if (s.raw_is_active === false) {
        const changed = ex.plaid_is_active !== false;
        if (open?.status === "open") {
          plan.review_items.push(still_a_bill_item(input, cur, open)); // keep (refresh) the question
        } else if ((changed || reopens(open)) && is_shown(ex, input.now_ms) && ex.plaid_inactive_ack_ms === null && !is_user_answered(open)) {
          plan.review_items.push(still_a_bill_item(input, cur, open));
        }
      } else if (open?.status === "open") {
        plan.review_items.push(resolve_review_item(open, "auto_active", input.now_ms)); // Plaid back on
      }
      continue;
    }

    // ── New stream.
    if (!s.entity) continue; // rejected and no record: nothing to do (as today)
    // Absorb, never save (D3 / D42): the same bill as a converted record → recorded on it, not saved.
    // Independent of the flag (D16: the record decides).
    const absorber = find_absorber(s, stream_vendor(s), same_bill_pool);
    if (absorber) {
      const taken = plan_absorb(absorber, s, input.now_ms, in_response_stream_ids, absorb_writes.get(absorber.id));
      if (taken !== "declined" && taken !== "full") {
        if (taken) absorb_writes.set(absorber.id, taken);
        // The stream counts as handled: its held-out payments are released and a pending track of
        // the vendor is fulfilled — as if its bill had been saved.
        saved_ids.add(s.stream_id);
        const subject = suggested_subject(s.direction, stream_vendor(s));
        if (!saved_by_subject.has(subject)) saved_by_subject.set(subject, s);
        effect(s).release.push(...s.transaction_ids);
        continue;
      }
      // declined (the user undid the absorb) or no room: the stream is handled as any new stream
    }
    if (!input.flag_on) {
      // A vendor the user said "Not a bill" for — or whose converted bill they deleted, which
      // records the same memory so its absorbed stream never returns as a new Plaid bill (P9) — stays
      // skipped even with the flag off (the memory is the user's, not the flag's).
      if (is_vendor_dismissed(input.state, s.direction, stream_vendor(s))) {
        suppress(s.transaction_ids);
        continue;
      }
      save(s, s.entity); // today's handling (no stamp)
      continue;
    }
    if (s.raw_is_active === false) {
      save(s, s.entity); // X2: a stream first seen inactive keeps today's handling
      continue;
    }
    const vk = stream_vendor(s);
    const suggested = item_at("suggested", suggested_subject(s.direction, vk));
    const same_bill = item_at("same_bill", s.stream_id);
    const pending_item = pending_by_stream.get(s.stream_id);
    const tracked =
      (suggested && suggested.answer === "track" && suggested.status === "resolved") ||
      (same_bill && (same_bill.answer === "keep_separate" || same_bill.answer === "same_bill") && same_bill.status === "resolved") ||
      !!pending_item;
    if (tracked) {
      const picked =
        suggested?.answer === "track" && suggested.status === "resolved"
          ? suggested.user_frequency
          : pending_item?.answer === "track"
            ? pending_item.user_frequency
            : null;
      // "Same bill" (D7 / D22): the new bill continues the old one — it inherits the user's name,
      // expected amount and schedule IN ITS CREATE PAYLOAD (a later update would re-materialize
      // every period: the amount trigger has no by-sync guard).
      const merged_from = [same_bill, pending_item].find((it) => it?.answer === "same_bill" && it.status === "resolved")?.record_id;
      const old = merged_from ? pool_by_id.get(merged_from) : undefined;
      create_v2(s, picked ?? old?.user_frequency ?? null, old);
      // The answered item's held-out payments are released now that the bill exists (not at
      // answer time — fix round: the hold-out must cover the gap until creation).
      // Only the item's OWN stream releases its ids (another item's stream of the same vendor
      // may be tracked too; the item's stream is resolved by its pending track, defect 4).
      for (const it of new Set([suggested, same_bill, pending_item])) {
        if (it && it.status === "resolved" && it.source === "plaid" && it.stream_id === s.stream_id) {
          effect(s).release.push(...it.transaction_ids);
        }
      }
      continue;
    }
    if (is_tombstoned_stream(s.raw_status)) {
      suppress(s.transaction_ids); // D17: skipped — and never fuzzy-linked to an old bill (X3)
      continue;
    }
    if (is_vendor_dismissed(input.state, s.direction, vk) || suggested?.answer === "not_bill") {
      suppress(s.transaction_ids); // "Not a bill" is remembered, maturity included (X14)
      // A tile left OPEN for a vendor the user dismissed (written by a racing writer before the
      // guard, or by the detector) is closed as dismissed — it would otherwise stay forever.
      if (suggested?.status === "open") plan.review_items.push(resolve_review_item(suggested, "not_bill", input.now_ms));
      continue;
    }
    if (is_low_confidence_stream(s.raw_status, s.raw_frequency)) {
      suppress(s.transaction_ids);
      if (may_suggest_stream(s.direction, s.detailed_category, s.account_type)) {
        // Built after the loop, ONE stream per vendor chosen deterministically (defect 2).
        suggest_candidates.push({ s, subject: suggested_subject(s.direction, vk), existing: suggested });
      }
      continue;
    }
    // Same bill? A new stream replacing a bill that STOPPED is held as a question, not a second
    // bill (D7, D10: no double count while unanswered). Two active streams never match.
    const replaced = find_replaced_record(s, vk, same_bill_pool, same_bill_ctx);
    if (replaced) {
      suppress(s.transaction_ids);
      plan.review_items.push(same_bill_item(input, s, replaced, same_bill));
      continue;
    }
    if (input.same_bill && !input.same_bill.inactive_loaded) plan.wants_inactive_records = true;
    // Mature, known schedule, active → a v2 record.
    create_v2(s, null);
    if (suggested?.status === "open") {
      // Closed after the loop — unless another low-confidence stream of the vendor keeps it.
      matured.set(suggested_subject(s.direction, vk), { item: suggested, s });
    }
  }

  // ── Suggested tiles: one per vendor, built from ONE stream chosen deterministically (review
  //    round 3 defect 2). Items are keyed per vendor but built from a single stream, so two Plaid
  //    items with an early stream of the same vendor (or a reordered stream list) overwrote each
  //    other on every sync. Now:
  //      - a vendor whose stream matured into a bill this sync: its open tile is closed "matured"
  //        — unless another of its streams is still low-confidence, which then keeps the tile
  //        (closing it here only for the next sync to reopen it flip-flopped; Top-25 #23);
  //      - an OPEN tile owned by ANOTHER Plaid item's stream is left as it is (that item's sync
  //        maintains it; this sync can't see that stream);
  //      - otherwise the tile keeps its stored stream while that stream is in this response, else
  //        takes the smallest stream id — the same input always builds the same item.
  const by_subject = new Map<string, SuggestCandidate[]>();
  for (const c of suggest_candidates) {
    if (!by_subject.has(c.subject)) by_subject.set(c.subject, []);
    by_subject.get(c.subject)!.push(c);
  }
  // An OPEN tile owned by ANOTHER Plaid item's stream (round 4 defect 1): that item's stream is
  // still low-confidence (its sync keeps the tile) — this item's stream maturing must not close
  // it (the other item's next sync reopened it: a close + reopen on every pair of syncs).
  const owned_elsewhere = (ex: ReviewItem | undefined): boolean =>
    !!ex && ex.status === "open" && ex.source === "plaid" && !!ex.plaid_item_doc_id &&
    ex.plaid_item_doc_id !== input.plaid_item_doc_id;
  for (const [subject, m] of matured) {
    if (by_subject.has(subject)) continue; // still suggested via another stream (below)
    if (owned_elsewhere(m.item)) continue;
    const closed = resolve_review_item(m.item, "matured", input.now_ms);
    plan.review_items.push(closed);
    effect(m.s).item_ids.push(closed.id);
    effect(m.s).release.push(...m.item.transaction_ids);
  }
  for (const [, group] of by_subject) {
    const ex = group[0].existing;
    if (owned_elsewhere(ex)) continue;
    const sorted = [...group].sort((a, b) => (a.s.stream_id < b.s.stream_id ? -1 : a.s.stream_id > b.s.stream_id ? 1 : 0));
    const pick = (ex?.stream_id && sorted.find((c) => c.s.stream_id === ex.stream_id)) || sorted[0];
    plan.review_items.push(suggested_item(input, pick.s, ex));
  }

  // ── Let go of this item's tiles whose stream it no longer sees (round 4 defect 2). An OPEN
  //    Plaid tile owned by this item, not rebuilt or closed above, whose stream isn't in this
  //    response: no sync will ever see that stream again, and another item's live stream of the
  //    vendor can't take a tile this item owns. Closed `stream_gone` (a system close: the vendor's
  //    next live stream reopens it, owned by its item); its held-out payments are released.
  //    Round 5 defects 1 + 2: a stream still IN the response but no longer a suggest candidate for
  //    the tile's OWN subject — tombstoned, an invalid entity, first seen inactive, or renamed to
  //    another vendor (merchant rename: it now builds the new vendor's tile) — lets go of the tile
  //    too. Skipping it on "in the response" left the tile open, dropped from the owners list
  //    (it wasn't rebuilt), so once the stream vanished no sync loaded it again: stranded open
  //    forever, and no other item's live stream could take it over; after a rename it stayed a
  //    second open tile of the same stream. With the flag off no candidates are built at all, so
  //    "in the response" still keeps the tile as it is (today's handling).
  const in_response_ids = new Set(input.streams.map((x) => x.stream_id));
  const candidate_for = (it: ReviewItem): boolean =>
    suggest_candidates.some((c) => c.s.stream_id === it.stream_id && c.subject === it.subject_key);
  const planned = new Set(plan.review_items.map((i) => i.id));
  // Payments held out again this round (the renamed vendor's new tile, a tombstoned stream — D17)
  // stay held: only the rest of the let-go tile's ids are released.
  const held_now = new Set(base_change.add_suppressed);
  for (const it of input.review_items.values()) {
    if (it.kind !== "suggested" || it.status !== "open" || it.source !== "plaid") continue;
    if (it.plaid_item_doc_id !== input.plaid_item_doc_id || planned.has(it.id)) continue;
    if (it.stream_id && in_response_ids.has(it.stream_id) && (!input.flag_on || candidate_for(it))) continue;
    plan.review_items.push(resolve_review_item(it, "stream_gone", input.now_ms));
    base_change.remove_suppressed.push(...it.transaction_ids.filter((id) => !held_now.has(id)));
  }

  function create_v2(s: PlannerStream, user_frequency: string | null, inherit?: PlannerRecord): void {
    save(s, {
      ...s.entity!,
      ...(inherit?.custom_name ? { user_custom_name: inherit.custom_name } : {}),
      ...(inherit?.expected_amount_override != null ? { expected_amount_override: inherit.expected_amount_override } : {}),
      capture_rules_version: CAPTURE_RULES_VERSION,
      plaid_is_active: true,
      // A card-side "payment received" credit isn't income: hidden from creation (gap 3, X7) —
      // the v2 classifier keeps it hidden.
      ...(s.direction === "inflow" && is_card_payment_inflow(s.detailed_category) ? { is_hidden: true } : {}),
      ...(user_frequency ? { user_frequency: user_frequency as OutflowForPersistence["frequency"] } : {}),
    } as OutflowForPersistence | InflowForPersistence, true);
  }

  // ── Stale candidates (this item's active records Plaid didn't return as valid).
  const in_response = new Set(input.streams.map((s) => s.stream_id));
  for (const r of input.stale_candidates) {
    if (!r.v2) {
      // A record merged into another bill (D41) is exempt: Plaid never stales it.
      if (!r.merged_into_id) (r.direction === "outflow" ? plan.stale_outflow_ids : plan.stale_inflow_ids).push(r.id);
      continue;
    }
    if (in_response.has(r.id)) continue; // v2 + rejected: kept as is (gap 8 / X10)
    // v2 + Plaid stopped returning it → Plaid's opinion recorded; the user is asked (D19).
    if (r.plaid_is_active !== false) {
      (r.direction === "outflow" ? plan.plaid_inactive_outflow_ids : plan.plaid_inactive_inflow_ids).push(r.id);
    }
    const open = item_at("still_a_bill", r.id);
    if (open?.status === "open" && !is_shown(r, input.now_ms)) {
      plan.review_items.push(resolve_review_item(open, "not_shown", input.now_ms)); // moot (defect 5)
    } else if (open?.status === "open") {
      plan.review_items.push(still_a_bill_item(input, r, open));
    } else if ((r.plaid_is_active !== false || reopens(open)) && is_shown(r, input.now_ms) && r.plaid_inactive_ack_ms === null && !is_user_answered(open)) {
      plan.review_items.push(still_a_bill_item(input, r, open));
    }
  }

  // ── Pending tracks of THIS Plaid item (defect 4): every "Track" / "Keep separate" gets an
  //    outcome. Its stream saved (v2 — or unstamped: flag off at the re-sync / first seen
  //    inactive) → the bill exists: fulfilled, its payments released with the save. Its stream gone
  //    from the response, rejected, or on a removed account → no bill can be made: the payments
  //    are released (normal transactions again) and the item is closed `track_unavailable` (a
  //    system close: the vendor may be suggested again if Plaid brings it back).
  const by_stream = new Map(input.streams.map((x) => [x.stream_id, x]));
  const record_vendor = (r: PlannerRecord) => vendor_key({ merchant_name: r.merchant_name, name: r.description });
  // A bill of the vendor that exists already (made by another item's sync, say) fulfils the track.
  const has_vendor_bill = (it: ReviewItem): boolean =>
    !!it.vendor_key &&
    same_bill_pool.some((r) => r.v2 && r.is_active && !r.merged_into_id && r.direction === it.direction && record_vendor(r) === it.vendor_key);
  const handoff = new Set<string>();
  const close_unavailable = (pt: PendingTrack, item: ReviewItem | undefined, s: PlannerStream | undefined) => {
    base_change.remove_pending_track_ids.push(pt.item_id);
    if (!item) return;
    base_change.remove_suppressed.push(...item.transaction_ids, ...(s?.transaction_ids ?? []));
    if (item.status === "resolved" && (item.answer === "track" || item.answer === "keep_separate")) {
      plan.review_items.push(resolve_review_item(item, "track_unavailable", input.now_ms));
    }
  };
  for (const pt of input.state?.pending_tracks ?? []) {
    const handed_off = typeof pt.handed_off_ms === "number";
    if (!handed_off && pt.plaid_item_doc_id !== input.plaid_item_doc_id) continue;
    const item = input.review_items.get(pt.item_id);
    const s = !handed_off && pt.stream_id ? by_stream.get(pt.stream_id) : undefined;
    if (s && saved_ids.has(s.stream_id)) {
      effect(s).remove_pending.push(pt.item_id);
      if (item) effect(s).release.push(...item.transaction_ids);
      continue;
    }
    const aged = input.now_ms - pt.since_ms >= PENDING_TRACK_MAX_AGE_MS;
    if (s && s.entity && !aged) continue; // still pending (backstop: never forever)
    // Its own stream is gone / rejected (or the track was handed off): another stream of the same
    // vendor saved this round, or a bill of the vendor that already exists, fulfils it (defect 2).
    const subject = item?.vendor_key ? suggested_subject(item.direction, item.vendor_key) : null;
    const by_vendor = subject ? saved_by_subject.get(subject) : undefined;
    if (item && by_vendor) {
      effect(by_vendor).remove_pending.push(pt.item_id);
      effect(by_vendor).release.push(...item.transaction_ids);
      continue;
    }
    if (item && has_vendor_bill(item)) {
      base_change.remove_pending_track_ids.push(pt.item_id);
      base_change.remove_suppressed.push(...item.transaction_ids);
      continue;
    }
    if (handed_off) {
      // Waiting on the user's other items: this one has synced without the vendor.
      const awaiting = (pt.awaiting_item_doc_ids ?? []).filter((id) => id !== input.plaid_item_doc_id);
      if (awaiting.length === 0 || input.now_ms - pt.handed_off_ms! >= PENDING_HANDOFF_TTL_MS) {
        close_unavailable(pt, item, undefined);
      } else if (awaiting.length !== (pt.awaiting_item_doc_ids ?? []).length) {
        (base_change.add_pending_tracks ??= []).push({ ...pt, awaiting_item_doc_ids: awaiting });
      }
      continue;
    }
    // Gone from THIS item: another of the user's Plaid items may have a live stream of the vendor
    // (the tile could be owned by a stream that vanished) — hand the track to them, never lose it.
    const others = (input.other_item_doc_ids ?? []).filter((id) => id !== input.plaid_item_doc_id);
    if (item && others.length > 0 && !aged) {
      (base_change.add_pending_tracks ??= []).push({
        ...pt, plaid_item_doc_id: null, handed_off_ms: input.now_ms, awaiting_item_doc_ids: [...others].sort(),
      });
      for (const id of others) handoff.add(id);
      continue;
    }
    if (item && !aged && input.other_item_doc_ids === undefined) plan.wants_other_items = true;
    close_unavailable(pt, item, s);
  }
  if (handoff.size > 0) plan.handoff_item_doc_ids = [...handoff].sort();

  // ── The open suggested tiles this item now owns (defect 2): stored only when they changed.
  //    Round 5 defect 1: from the FINAL view — the loaded items overlaid by this plan's — so a tile
  //    this item still owns and leaves open (not rebuilt this sync) stays on the list, and the
  //    item's next sync can always load it (close it / let it go) once its stream is gone.
  const final_view = new Map(input.review_items);
  for (const i of plan.review_items) final_view.set(i.id, i);
  const owned_now = [...final_view.values()]
    .filter((i) => i.kind === "suggested" && i.status === "open" && i.source === "plaid" && i.plaid_item_doc_id === input.plaid_item_doc_id)
    .map((i) => i.id).sort();
  const owned_before = (input.state?.suggested_owners ?? [])
    .filter((o) => o.plaid_item_doc_id === input.plaid_item_doc_id).map((o) => o.item_id).sort();
  if (owned_now.join("\n") !== owned_before.join("\n")) {
    base_change.set_suggested_owners = { plaid_item_doc_id: input.plaid_item_doc_id, item_ids: owned_now };
  }
  // Round 5: owner entries of a Plaid item the user no longer has are dropped — only when this
  // sync already loaded the user's items (no extra read for it).
  if (input.other_item_doc_ids !== undefined) {
    const live = new Set([input.plaid_item_doc_id, ...input.other_item_doc_ids]);
    if ((input.state?.suggested_owners ?? []).some((o) => !live.has(o.plaid_item_doc_id))) {
      base_change.keep_owner_item_doc_ids = [...live].sort();
    }
  }

  // Ids both suppressed and saved this round end saved (stream membership wins).
  if (absorb_writes.size > 0) plan.absorbs = [...absorb_writes.values()].sort((a, b) => (a.record_id < b.record_id ? -1 : 1));
  plan.base_change = base_change;
  plan.save_effects = [...effects.values()];
  plan.state_change = compose_state_change(base_change, plan.save_effects);
  return plan;
}
