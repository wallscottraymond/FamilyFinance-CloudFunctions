/**
 * Detect Possible Recurring Orchestrator (Convert-To-Recurring D11 / X12 / X14 / X17 / X19).
 *
 * The "possible bill" detector runs at most once per user per UTC day, flag-on users only, on the
 * transactions the transfer classifier ALREADY loaded for its full scan (X12: no extra transaction
 * read). ONE way in: `run_detector_on_scan` is called by `classify_internal_transfers_orchestrator`
 * after any full scan it was going to do anyway. There is deliberately NO fallback job: a job
 * that forces a classifier scan would cost a full transaction read (X12 says zero extra reads).
 * A day without a full scan simply has no detector run; the throttle (detector day in the review
 * state doc) keeps it to at most once per UTC day.
 *
 * Writes: suggested review items (only new / changed ones) + the state's detector day. Never a
 * dismissed vendor (R11), never a bill record, never a derive bump (detector items don't feed the
 * derive). Checks `is_user_purging` before writing (X19).
 *
 * @module orchestrators/recurring/detect_possible_recurring
 */
import { TraceContext } from "../../types";
import { DetectorTxn } from "../../domain/recurring/recurring_detector.service";
export interface DetectorScan {
    txns: DetectorTxn[];
    internal_txn_ids: Set<string>;
    /** The active records the classifier loaded (ids + stream ids + vendor fields). */
    records: Array<{
        kind: "outflow" | "inflow";
        transaction_ids: string[];
        merchant_name: string | null;
        description: string | null;
    }>;
}
export interface DetectorRunResult {
    ran: boolean;
    reason?: "flag_off" | "already_today" | "purging";
    candidates: number;
    items_written: number;
    capped: boolean;
}
/** Run the detector on a classifier scan (inline path). Non-throwing callers wrap it. */
export declare function run_detector_on_scan(ctx: TraceContext, user_id: string, now_ms: number, scan: DetectorScan): Promise<DetectorRunResult>;
//# sourceMappingURL=detect_possible_recurring.orchestrator.d.ts.map