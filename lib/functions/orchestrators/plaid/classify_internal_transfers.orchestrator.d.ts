/**
 * Classify Internal Transfers (orchestrator step)
 *
 * Plaid recurring detection recreates internal account-transfer streams on every
 * sync (they're subscribed) and adds more when new cards are linked. We can't tell
 * an internal transfer from an external ACH bill at transform time — it needs
 * matched-pair detection across accounts. So AFTER each recurring sync we classify
 * the user's recurring outflow/inflow records and durably HIDE the internal ones
 * (kept: external ACH bills + credit-card payments). `isHidden` is preserved by
 * `save_batch`, so the hide survives future re-syncs of the same stream.
 *
 * Self-correcting: also UN-hides transfer records that are no longer internal.
 *
 * READ COST: it runs after every per-item recurring sync (4 cycles/day × N items), but its
 * answer only changes when the recurring records change. So it fingerprints its inputs
 * (each active record's id, category, stream transaction ids and hidden flag) and SKIPS the
 * 180-day transaction scan when the fingerprint matches the last full run AND that run is
 * < 24h old. The 24h backstop covers the one input the fingerprint can't see: a transfer's
 * matched counterpart posting later on another account (previously picked up ≤6h later).
 *
 * @module orchestrators/plaid/classify_internal_transfers
 */
import { TraceContext } from "../../types";
export interface ClassifyInternalTransfersResult {
    hidden_outflows: number;
    hidden_inflows: number;
    /** True when the inputs were unchanged and the transaction scan was skipped. */
    skipped: boolean;
}
export declare function classify_internal_transfers_orchestrator(ctx: TraceContext, user_id: string, now_ms: number, 
/** `force`: transfer transactions were just written — a new matched pair can exist even though
 *  the recurring records (all the fingerprint covers) are unchanged. */
opts?: {
    force?: boolean;
}): Promise<ClassifyInternalTransfersResult>;
/**
 * Re-decide transfer roles only AROUND one transaction (a user moved it into / out of a transfer
 * category). A role depends only on legs within the pairing slack, so the transactions within
 * [date − slack, date + slack] are re-decided with the SAME pairing as the full run (which reads
 * ~6 months); stream hiding is left to the daily full pass. Changed roles are written, re-assigned
 * in one batch with one follow-up, and partners refreshed — exactly as the full run does.
 */
export declare function classify_transfers_around(ctx: TraceContext, user_id: string, txn_date_ms: number): Promise<void>;
/** Job type: re-classify one user's transfers (forced) — a partner's pair changed. */
export declare const CLASSIFY_TRANSFERS_JOB = "classify_transfers";
//# sourceMappingURL=classify_internal_transfers.orchestrator.d.ts.map