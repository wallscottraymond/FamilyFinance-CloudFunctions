/**
 * Bills-to-review items + the per-user review state (Convert-To-Recurring Phase 1, D9 / D14 / X8).
 *
 * REVIEW ITEMS (`recurring_review_items`) are what the app shows: one per (owner, kind, subject),
 * at a DETERMINISTIC id so every writer is idempotent with no exists-query and every reader can
 * `getAll` the ids of the subjects it has in hand (X8):
 *   - `suggested`    — a possible bill / income (Plaid low-confidence stream, or the detector);
 *                      subject = direction + VENDOR KEY (X14: one tile per vendor, whatever found it)
 *   - `still_a_bill` — a v2 bill Plaid turned off / stopped returning; subject = the record id
 *   - `same_bill`    — a new Plaid stream that looks like a stopped bill's replacement; subject =
 *                      the new stream id
 * Vendor keys can contain "/" (e.g. "paypal /inst xfer"), so subjects are HASHED into the id.
 *
 * REVIEW STATE (`_recurring_review_state/{uid}`, server-only) is what the backend must remember:
 * the Plaid transaction ids held out of fuzzy bill matching (open + dismissed suggestions, X3),
 * the "Not a bill" vendor keys (D11), and the detector's daily throttle. One `get` per reader;
 * written only when its content changes.
 *
 * PURE: no IO (hashing is deterministic).
 *
 * @module domain/recurring/review_item
 */

import { createHash } from "crypto";

export type ReviewKind = "suggested" | "still_a_bill" | "same_bill";
export type ReviewStatus = "open" | "resolved" | "dismissed";
export type ReviewDirection = "outflow" | "inflow";
export type ReviewSource = "plaid" | "detector";
/** User answers + the system's own closes (matured / back active / account removed). */
export type ReviewAnswer =
  | "track"
  | "not_bill"
  | "still_a_bill"
  | "it_ended"
  | "keep_separate"
  | "same_bill"
  | "matured"
  | "auto_active"
  | "account_removed";

/** A review item (snake_case domain shape; the repo maps it to the camelCase doc). */
export interface ReviewItem {
  id: string;
  user_id: string;
  kind: ReviewKind;
  direction: ReviewDirection;
  source: ReviewSource;
  status: ReviewStatus;
  answer: ReviewAnswer | null;
  /** The un-hashed subject (vendor key / record id / stream id) the id was built from. */
  subject_key: string;
  vendor_key: string | null;
  /** Plaid account id the payments come from (account removal closes its items). */
  account_id: string | null;
  /** plaid_items doc id (a "track" / "keep separate" answer re-syncs this item). */
  plaid_item_doc_id: string | null;
  /** Plaid stream id (Plaid suggestions / same-bill new stream). */
  stream_id: string | null;
  /** The record the question is about (still a bill: the bill; same bill: the stopped bill). */
  record_id: string | null;
  name: string;
  amount: number;
  /** Detected schedule (null = Plaid said UNKNOWN; the user picks one, D8). */
  frequency: string | null;
  plaid_status: string | null;
  category: string | null;
  /** The payments behind it (Plaid ids for Plaid streams; doc ids for the detector). Bounded. */
  transaction_ids: string[];
  next_due_ms: number | null;
  /** Answer detail: the schedule the user picked when tracking. */
  user_frequency: string | null;
  content_hash: string;
  created_at_ms: number;
  updated_at_ms: number;
  resolved_at_ms: number | null;
}

/** The per-user review state (snake_case domain shape). */
export interface RecurringReviewState {
  user_id: string;
  /** Plaid transaction ids held out of FUZZY bill / income matching (open + dismissed suggestions). */
  suppressed_txn_ids: string[];
  /** "Not a bill" / "Not income" vendor memory: `${direction}:${vendor_key}`. */
  dismissed_vendor_keys: string[];
  /** UTC day (YYYY-MM-DD) the possible-bill detector last ran fully. */
  detector_last_run_day: string | null;
}

/**
 * Bounds (CLAUDE.md write rule 9: every array field has a prune policy). The held-out ids are
 * capped DETERMINISTICALLY (review round 3 defect 6): the set is kept sorted and the first
 * MAX_SUPPRESSED_TXN_IDS ids are kept, so identical input always yields the identical stored set
 * — an insertion-order cap evicted a different subset each sync (each re-added id pushed another
 * out: a write + a derive bump + a re-assign on every sync). Vendor keys only ever grow by a
 * user's tap; their cap drops the oldest.
 */
export const MAX_SUPPRESSED_TXN_IDS = 5000;
export const MAX_DISMISSED_VENDOR_KEYS = 1000;
export const MAX_ITEM_TRANSACTION_IDS = 60;
/** Resolved items expire (console TTL policy on `expireAt`); open + dismissed never carry it. */
export const RESOLVED_ITEM_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const sha1 = (s: string): string => createHash("sha1").update(s).digest("hex");

/** The subject a `suggested` item is keyed by: direction + vendor key (X14). */
export function suggested_subject(direction: ReviewDirection, vendor_key: string): string {
  return `${direction}:${vendor_key}`;
}

/** Deterministic review-item id: `${uid}__${kind}__${sha1(subject)[0..24]}` (subjects may hold "/"). */
export function build_review_item_id(user_id: string, kind: ReviewKind, subject_key: string): string {
  return `${user_id}__${kind}__${sha1(subject_key).slice(0, 24)}`;
}

/** Parse the owner uid out of an item id (the prefix before the first `__`). */
export function owner_of_review_item_id(item_id: string): string | null {
  const i = item_id.indexOf("__");
  return i > 0 ? item_id.slice(0, i) : null;
}

/** The fields that, when changed, make an item worth rewriting (timestamps excluded). */
export function review_content_hash(
  item: Omit<ReviewItem, "content_hash" | "created_at_ms" | "updated_at_ms" | "id">
): string {
  return sha1(
    JSON.stringify([
      item.user_id, item.kind, item.direction, item.source, item.status, item.answer,
      item.subject_key, item.vendor_key, item.account_id, item.plaid_item_doc_id, item.stream_id,
      item.record_id, item.name, Math.round(item.amount * 100), item.frequency, item.plaid_status,
      item.category, [...item.transaction_ids].sort(), item.next_due_ms, item.user_frequency,
      item.resolved_at_ms,
    ])
  );
}

/** Build a complete item from its parts (id + hash computed). */
export function make_review_item(
  parts: Omit<ReviewItem, "id" | "content_hash" | "created_at_ms" | "updated_at_ms">,
  now_ms: number,
  existing?: ReviewItem | null
): ReviewItem {
  const transaction_ids = parts.transaction_ids.slice(-MAX_ITEM_TRANSACTION_IDS);
  const body = { ...parts, transaction_ids };
  return {
    ...body,
    id: build_review_item_id(parts.user_id, parts.kind, parts.subject_key),
    content_hash: review_content_hash(body),
    created_at_ms: existing?.created_at_ms ?? now_ms,
    updated_at_ms: now_ms,
  };
}

/** Only items whose content changed are written (X8 / R5: an identical re-sync writes nothing). */
export function changed_items(next: ReviewItem[], existing: Map<string, ReviewItem>): ReviewItem[] {
  const seen = new Set<string>();
  const out: ReviewItem[] = [];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (existing.get(item.id)?.content_hash === item.content_hash) continue;
    out.push(item);
  }
  return out;
}

/** Close an item with an answer (status from the answer). */
export function resolve_review_item(
  item: ReviewItem,
  answer: ReviewAnswer,
  now_ms: number,
  extra?: { user_frequency?: string | null }
): ReviewItem {
  const status: ReviewStatus = answer === "not_bill" ? "dismissed" : "resolved";
  return make_review_item(
    {
      ...item,
      status,
      answer,
      user_frequency: extra?.user_frequency ?? item.user_frequency,
      resolved_at_ms: now_ms,
    },
    now_ms,
    item
  );
}

export function empty_review_state(user_id: string): RecurringReviewState {
  return { user_id, suppressed_txn_ids: [], dismissed_vendor_keys: [], detector_last_run_day: null };
}

/** Hash of the derive-relevant part of the state: only the suppressed ids feed the derive. */
export function suppressed_hash(state: RecurringReviewState | null): string {
  return sha1([...(state?.suppressed_txn_ids ?? [])].sort().join(","));
}

export interface ReviewStateChange {
  add_suppressed?: string[];
  remove_suppressed?: string[];
  add_dismissed_vendor_keys?: string[];
  detector_last_run_day?: string;
}

/**
 * Apply a change to the state. Returns the next state and what changed: `changed` → write it;
 * `suppressed_changed` → the derive's input changed too (bump the derive version, X3). PURE.
 */
export function apply_review_state_change(
  current: RecurringReviewState | null,
  user_id: string,
  change: ReviewStateChange
): { next: RecurringReviewState; changed: boolean; suppressed_changed: boolean } {
  const base = current ?? empty_review_state(user_id);
  const remove = new Set(change.remove_suppressed ?? []);
  const have = new Set(base.suppressed_txn_ids.filter((id) => !remove.has(id)));
  for (const id of change.add_suppressed ?? []) have.add(id);
  const suppressed = cap_suppressed_ids([...have]);
  const dismissed = [...base.dismissed_vendor_keys];
  const have_d = new Set(dismissed);
  for (const k of change.add_dismissed_vendor_keys ?? []) {
    if (!have_d.has(k)) {
      dismissed.push(k);
      have_d.add(k);
    }
  }
  const next: RecurringReviewState = {
    user_id,
    suppressed_txn_ids: suppressed,
    dismissed_vendor_keys: dismissed.slice(-MAX_DISMISSED_VENDOR_KEYS),
    detector_last_run_day: change.detector_last_run_day ?? base.detector_last_run_day,
  };
  const suppressed_changed = suppressed_hash(next) !== suppressed_hash(current);
  const changed =
    !current ||
    suppressed_changed ||
    next.dismissed_vendor_keys.join("\n") !== base.dismissed_vendor_keys.join("\n") ||
    next.detector_last_run_day !== base.detector_last_run_day;
  // A brand-new state that holds nothing is not worth a write.
  const is_empty =
    next.suppressed_txn_ids.length === 0 &&
    next.dismissed_vendor_keys.length === 0 &&
    next.detector_last_run_day === null;
  return { next, changed: changed && !(current === null && is_empty), suppressed_changed };
}

/** The deterministic held-out cap: sorted, first MAX_SUPPRESSED_TXN_IDS kept (defect 6). PURE. */
export function cap_suppressed_ids(ids: string[]): string[] {
  return [...new Set(ids)].sort().slice(0, MAX_SUPPRESSED_TXN_IDS);
}

/** Is this vendor remembered as "Not a bill" / "Not income" for the user? */
export function is_vendor_dismissed(
  state: RecurringReviewState | null,
  direction: ReviewDirection,
  vendor_key: string | null
): boolean {
  if (!state || !vendor_key) return false;
  return state.dismissed_vendor_keys.includes(suggested_subject(direction, vendor_key));
}

/** UTC day key `YYYY-MM-DD`. */
export function utc_day(now_ms: number): string {
  return new Date(now_ms).toISOString().slice(0, 10);
}
