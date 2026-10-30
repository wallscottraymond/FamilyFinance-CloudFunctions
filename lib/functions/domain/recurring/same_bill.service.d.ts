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
import type { PlannerRecord, PlannerStream } from "./recurring_capture_planner.service";
/** The new stream may start this long before the old one's last payment (overlap at the switch). */
export declare const SAME_BILL_OVERLAP_MS: number;
/** …and at most this long after it (a stream that stopped long ago isn't being replaced). */
export declare const SAME_BILL_GAP_MS: number;
export interface SameBillContext {
    /** Plaid account ids still active for the user (account-removal soft deletes are excluded). */
    active_account_ids: Set<string>;
    /** Record ids this sync reports stopped: returned inactive, or not returned at all. */
    stopped_in_sync: Set<string>;
}
/** Has this record stopped (and not because its account was removed)? PURE. */
export declare function has_stopped(r: PlannerRecord, c: SameBillContext): boolean;
/**
 * The stopped record a new stream replaces, or null. When several qualify, the one that stopped
 * most recently wins (deterministic: then by id). PURE.
 */
export declare function find_replaced_record(stream: PlannerStream & {
    first_date_ms: number;
}, vendor: string, candidates: PlannerRecord[], c: SameBillContext): PlannerRecord | null;
//# sourceMappingURL=same_bill.service.d.ts.map