/**
 * Delete Budget Types
 *
 * Types and Zod schema for the delete_budget flow in the 5-layer architecture.
 *
 * This replaces the legacy `onRequest` HTTP `deleteBudget` with an `onCall`
 * entry. The synchronous path validates and removes the budget document; the
 * heavy cascade (deleting budget_periods, reassigning transaction splits to
 * "Everything Else", releasing categories, cleaning user_summary) is deferred
 * to a Cloud Tasks job.
 *
 * @module types/budgets/delete_budget
 */
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { BudgetEntity } from "./budget_entity.types";
/**
 * Zod schema for the delete_budget request payload.
 */
export declare const delete_budget_input_schema: z.ZodObject<{
    idempotency_key: z.ZodString;
    budget_id: z.ZodString;
    debug_mode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Validated wire payload type (inferred from the schema).
 */
export type DeleteBudgetInputData = z.infer<typeof delete_budget_input_schema>;
/**
 * Normalized internal input passed to the orchestrator.
 */
export interface DeleteBudgetInput {
    budget_id: string;
}
/**
 * Dependencies resolved before deleting a budget (read-only).
 */
export interface DeleteBudgetDependencies {
    /** The existing budget being deleted */
    existing: BudgetEntity;
    /** Budget period IDs to delete */
    budget_period_ids: string[];
    /** Transaction IDs with splits referencing this budget (need reassignment) */
    affected_transaction_ids: string[];
    /** Categories owned by this budget (released back to Everything Else) */
    owned_category_ids: string[];
    /** The user's "Everything Else" budget ID (reassignment target) */
    everything_else_budget_id: string | null;
}
/**
 * Pure input for the delete_budget domain service. The domain service decides
 * whether the delete is allowed and what cascade work must be scheduled.
 */
export interface DeleteBudgetComputeInput {
    user_id: string;
    dependencies: DeleteBudgetDependencies;
    now: Timestamp;
}
/**
 * Pure result describing what the delete entails.
 */
export interface DeleteBudgetPlan {
    budget_id: string;
    /** Categories to release back to Everything Else */
    release_category_ids: string[];
    /** Whether a background cascade job is required */
    requires_cascade: boolean;
}
/**
 * Payload for the process_budget_deleted Cloud Tasks job.
 */
export interface ProcessBudgetDeletedPayload {
    budget_id: string;
    user_id: string;
    group_ids: string[];
    budget_period_ids: string[];
    affected_transaction_ids: string[];
    release_category_ids: string[];
    everything_else_budget_id: string | null;
}
/**
 * Response returned to the client after deleting a budget.
 */
export interface DeleteBudgetResponse {
    budget_id: string;
    /** True when cascade cleanup was deferred to a background job */
    processing_background: boolean;
}
/**
 * Orchestrator result wrapper.
 */
export interface DeleteBudgetOrchestratorResult {
    success: boolean;
    entity?: BudgetEntity;
    response?: DeleteBudgetResponse;
    errors?: string[];
}
/** Performance budget for the delete_budget orchestrator (sync path only). */
export declare const DELETE_BUDGET_BUDGET: {
    max_reads: number;
    max_writes: number;
    max_time_ms: number;
};
//# sourceMappingURL=delete_budget.types.d.ts.map