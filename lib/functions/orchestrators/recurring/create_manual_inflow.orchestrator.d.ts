/**
 * Create Manual Inflow Orchestrator (Convert-To-Recurring D43, flag on): Add Income through the
 * shared builder — v2 stamp, `source: "manual"`, the caller's own account verified, a D1 key only
 * from a real transaction, never a retro-link. Created stamped with its periods generated inline
 * and one derive bump (no trigger fan-out). The flag-off path stays in the legacy callable,
 * byte-identical.
 *
 * @module orchestrators/recurring/create_manual_inflow
 */
import { TraceContext } from "../../types";
import { ManualInflowRequest } from "../../domain/recurring/manual_inflow.service";
export type CreateManualInflowInput = Omit<ManualInflowRequest, "id" | "user_id" | "account_id" | "vendor_key" | "now_ms"> & {
    account_id?: string | null;
    source_transaction_id?: string | null;
};
export declare function create_manual_inflow_orchestrator(ctx: TraceContext, user_id: string, input: CreateManualInflowInput): Promise<{
    inflow_id: string;
}>;
//# sourceMappingURL=create_manual_inflow.orchestrator.d.ts.map