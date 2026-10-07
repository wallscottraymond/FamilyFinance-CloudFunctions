/**
 * Create Manual Outflow Orchestrator
 *
 * Creates a user-entered recurring bill (one Plaid didn't detect). Stored in the
 * same shape as a Plaid bill, so the period page, Home and widgets show it via
 * derive-on-read with no special case.
 *
 * @module orchestrators/recurring/create_manual_outflow
 */
import { OrchestratorContext } from "../../types";
import { ManualBillFrequency } from "../../domain/recurring/manual_outflow.service";
/**
 * Input for creating a bill.
 */
export interface CreateManualOutflowInput {
    name: string;
    merchant_name: string | null;
    amount: number;
    frequency: ManualBillFrequency;
    expense_type: string;
    is_essential: boolean;
    due_day: number | null;
}
/**
 * Result of creating a bill.
 */
export interface CreateManualOutflowResult {
    success: boolean;
    outflow_id?: string;
    errors?: string[];
}
/**
 * Orchestrates manual bill creation.
 *
 * @param ctx - Orchestrator context
 * @returns The new outflow ID, or validation errors
 */
export declare function create_manual_outflow_orchestrator(ctx: OrchestratorContext<CreateManualOutflowInput>): Promise<CreateManualOutflowResult>;
//# sourceMappingURL=create_manual_outflow.orchestrator.d.ts.map