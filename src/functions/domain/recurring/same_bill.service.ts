/**
 * Same bill? (Convert-To-Recurring D7 / X9) — does a NEW Plaid stream look like the replacement of
 * a bill that STOPPED (a plan, amount or account change: Sunbit's new plan, Hulu moving cards)?
 *
 * REPLACEMENT ONLY. A match needs, all of:
 *   - same direction, same vendor key, a different stream;
 *   - the old one has STOPPED: not active (stale / Plaid-inactive) — but never an account-removal
 *     soft delete (its account is gone) — or a v2 bill Plaid turned off, or a stream this very
 *     sync reports inactive / no longer returns;
 *   - the new one STARTED around or after the old one's last payment (first ≥ last − 10 days), and
 *     not long after it stopped (first ≤ last + 120 days).
 * Two streams that are BOTH still active are never the same bill (Shellpoint is paid twice a
 * month: two real bills).
 *
 * PURE: no IO.
 *
 * @module domain/recurring/same_bill
 */

import { vendor_key } from "../transactions/vendor_key.service";
import type { PlannerRecord, PlannerStream } from "./recurring_capture_planner.service";

const DAY = 24 * 60 * 60 * 1000;
/** The new stream may start this long before the old one's last payment (overlap at the switch). */
export const SAME_BILL_OVERLAP_MS = 10 * DAY;
/** …and at most this long after it (a stream that stopped long ago isn't being replaced). */
export const SAME_BILL_GAP_MS = 120 * DAY;

export interface SameBillContext {
  /** Plaid account ids still active for the user (account-removal soft deletes are excluded). */
  active_account_ids: Set<string>;
  /** Record ids this sync reports stopped: returned inactive, or not returned at all. */
  stopped_in_sync: Set<string>;
}

const record_vendor = (r: PlannerRecord): string | null =>
  vendor_key({ merchant_name: r.merchant_name, name: r.description });

/** Has this record stopped (and not because its account was removed)? PURE. */
export function has_stopped(r: PlannerRecord, c: SameBillContext): boolean {
  if (r.merged_into_id) return false;
  if (c.stopped_in_sync.has(r.id)) return true;
  if (r.v2 && r.plaid_is_active === false) return true;
  if (!r.is_active) return c.active_account_ids.has(r.account_id); // removed account → not stopped
  return false;
}

/**
 * The stopped record a new stream replaces, or null. When several qualify, the one that stopped
 * most recently wins (deterministic: then by id). PURE.
 */
export function find_replaced_record(
  stream: PlannerStream & { first_date_ms: number },
  vendor: string,
  candidates: PlannerRecord[],
  c: SameBillContext
): PlannerRecord | null {
  const matches = candidates.filter(
    (r) =>
      r.direction === stream.direction &&
      r.id !== stream.stream_id &&
      record_vendor(r) === vendor &&
      has_stopped(r, c) &&
      stream.first_date_ms >= r.last_date_ms - SAME_BILL_OVERLAP_MS &&
      stream.first_date_ms <= r.last_date_ms + SAME_BILL_GAP_MS
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.last_date_ms - a.last_date_ms || (a.id < b.id ? -1 : 1));
  return matches[0];
}
