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
 * @module orchestrators/plaid/classify_internal_transfers
 */
import { TraceContext } from "../../types";
export interface ClassifyInternalTransfersResult {
    hidden_outflows: number;
    hidden_inflows: number;
}
export declare function classify_internal_transfers_orchestrator(ctx: TraceContext, user_id: string, now_ms: number): Promise<ClassifyInternalTransfersResult>;
//# sourceMappingURL=classify_internal_transfers.orchestrator.d.ts.map