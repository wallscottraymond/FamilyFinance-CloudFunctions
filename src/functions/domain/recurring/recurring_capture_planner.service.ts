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
  is_low_confidence_stream,
  is_tombstoned_stream,
  may_suggest_stream,
} from "./capture_rules";
import {
  RecurringReviewState,
  ReviewDirection,
  ReviewItem,
  ReviewStateChange,
  build_review_item_id,
  is_vendor_dismissed,
  make_review_item,
  resolve_review_item,
  suggested_subject,
} from "./review_item.service";
import { is_currently_suppressed, RemovalInterval } from "./recurring_suppression.service";

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
}

/** The review-item ids a sync must look up for this response (X8: getAll, no query). */
export function review_ids_for_sync(
  user_id: string,
  streams: PlannerStream[],
  records: PlannerRecord[]
): string[] {
  const ids = new Set<string>();
  const has_record = new Set(records.map((r) => r.id));
  for (const s of streams) {
    if (has_record.has(s.stream_id)) continue; // suggested / same-bill only apply to NEW streams
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

/** The vendor key a stream is suggested under (falls back to the stream id). */
export function stream_vendor(s: { merchant_name: string | null; description: string | null; stream_id: string }): string {
  return vendor_key({ merchant_name: s.merchant_name, name: s.description }) ?? `stream:${s.stream_id}`;
}

/** Answers the system writes itself — an item closed this way can open again. */
const SYSTEM_CLOSE = new Set(["matured", "auto_active", "account_removed"]);
const is_user_answered = (item: ReviewItem | undefined): boolean =>
  !!item && item.status !== "open" && !!item.answer && !SYSTEM_CLOSE.has(item.answer);

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
  const save = (dir: ReviewDirection, e: OutflowForPersistence | InflowForPersistence) => {
    if (dir === "outflow") plan.save_outflows.push(e as OutflowForPersistence);
    else plan.save_inflows.push(e as InflowForPersistence);
  };
  const item_at = (kind: ReviewItem["kind"], subject: string) =>
    input.review_items.get(build_review_item_id(input.user_id, kind, subject));
  const suppress = (ids: string[]) => plan.state_change.add_suppressed!.push(...ids);
  const unsuppress = (ids: string[]) => plan.state_change.remove_suppressed!.push(...ids);

  for (const s of input.streams) {
    const ex = input.existing.get(s.stream_id);

    // ── Existing OLD record: today's path, untouched.
    if (ex && !ex.v2) {
      if (s.entity) save(s.direction, s.entity);
      continue;
    }

    // ── Existing v2 record: always kept, ours to turn on and off.
    if (ex && ex.v2) {
      if (!s.entity) continue; // rejected: not saved (invalid), never stale-marked (X10)
      const unknown_freq = is_low_confidence_stream("MATURE", s.raw_frequency);
      save(s.direction, {
        ...s.entity,
        is_active: ex.is_active,
        plaid_is_active: s.raw_is_active,
        // An UNKNOWN frequency would be invented as monthly by the transformer: keep ours.
        ...(unknown_freq ? { frequency: ex.frequency as OutflowForPersistence["frequency"] } : {}),
      } as OutflowForPersistence | InflowForPersistence);
      const open = item_at("still_a_bill", ex.id);
      if (s.raw_is_active === false) {
        const changed = ex.plaid_is_active !== false;
        if (open?.status === "open") {
          plan.review_items.push(still_a_bill_item(input, ex, open)); // keep (refresh) the question
        } else if (changed && is_shown(ex, input.now_ms) && ex.plaid_inactive_ack_ms === null && !is_user_answered(open)) {
          plan.review_items.push(still_a_bill_item(input, ex, open));
        }
      } else if (open?.status === "open") {
        plan.review_items.push(resolve_review_item(open, "auto_active", input.now_ms)); // Plaid back on
      }
      continue;
    }

    // ── New stream.
    if (!s.entity) continue; // rejected and no record: nothing to do (as today)
    if (!input.flag_on) {
      save(s.direction, s.entity); // today's handling (no stamp)
      continue;
    }
    if (s.raw_is_active === false) {
      save(s.direction, s.entity); // X2: a stream first seen inactive keeps today's handling
      continue;
    }
    const vk = stream_vendor(s);
    const suggested = item_at("suggested", suggested_subject(s.direction, vk));
    const same_bill = item_at("same_bill", s.stream_id);
    const tracked =
      (suggested && suggested.answer === "track" && suggested.status === "resolved") ||
      (same_bill && same_bill.answer === "keep_separate" && same_bill.status === "resolved");
    if (tracked) {
      create_v2(s, suggested?.answer === "track" ? suggested.user_frequency : null);
      continue;
    }
    if (is_tombstoned_stream(s.raw_status)) {
      suppress(s.transaction_ids); // D17: skipped — and never fuzzy-linked to an old bill (X3)
      continue;
    }
    if (is_vendor_dismissed(input.state, s.direction, vk) || suggested?.answer === "not_bill") {
      suppress(s.transaction_ids); // "Not a bill" is remembered, maturity included (X14)
      continue;
    }
    if (is_low_confidence_stream(s.raw_status, s.raw_frequency)) {
      suppress(s.transaction_ids);
      if (may_suggest_stream(s.direction, s.detailed_category, s.account_type)) {
        plan.review_items.push(suggested_item(input, s, suggested));
      }
      continue;
    }
    // Mature, known schedule, active → a v2 record.
    create_v2(s, null);
    if (suggested?.status === "open") {
      plan.review_items.push(resolve_review_item(suggested, "matured", input.now_ms));
      unsuppress(suggested.transaction_ids);
    }
  }

  function create_v2(s: PlannerStream, user_frequency: string | null): void {
    save(s.direction, {
      ...s.entity!,
      capture_rules_version: CAPTURE_RULES_VERSION,
      plaid_is_active: true,
      ...(user_frequency ? { user_frequency: user_frequency as OutflowForPersistence["frequency"] } : {}),
    } as OutflowForPersistence | InflowForPersistence);
    unsuppress(s.transaction_ids);
  }

  // ── Stale candidates (this item's active records Plaid didn't return as valid).
  const in_response = new Set(input.streams.map((s) => s.stream_id));
  for (const r of input.stale_candidates) {
    if (!r.v2) {
      (r.direction === "outflow" ? plan.stale_outflow_ids : plan.stale_inflow_ids).push(r.id);
      continue;
    }
    if (in_response.has(r.id)) continue; // v2 + rejected: kept as is (gap 8 / X10)
    // v2 + Plaid stopped returning it → Plaid's opinion recorded; the user is asked (D19).
    if (r.plaid_is_active !== false) {
      (r.direction === "outflow" ? plan.plaid_inactive_outflow_ids : plan.plaid_inactive_inflow_ids).push(r.id);
    }
    const open = item_at("still_a_bill", r.id);
    if (open?.status === "open") {
      plan.review_items.push(still_a_bill_item(input, r, open));
    } else if (r.plaid_is_active !== false && is_shown(r, input.now_ms) && r.plaid_inactive_ack_ms === null && !is_user_answered(open)) {
      plan.review_items.push(still_a_bill_item(input, r, open));
    }
  }

  // Ids both suppressed and saved this round end saved (stream membership wins).
  const saved = new Set(plan.state_change.remove_suppressed);
  plan.state_change.add_suppressed = plan.state_change.add_suppressed!.filter((id) => !saved.has(id));
  return plan;
}
