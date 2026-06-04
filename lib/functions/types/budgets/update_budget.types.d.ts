/**
 * Update Budget Types
 *
 * Types and Zod schema for the update_budget flow in the 5-layer architecture.
 *
 * This replaces the legacy `onRequest` HTTP `updateBudget` with an `onCall`
 * entry. Only the fields a client may change are accepted; system-budget
 * guardrails (no amount edits on "Everything Else", system flag immutable) are
 * enforced in the domain service.
 *
 * @module types/budgets/update_budget
 */
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { BudgetEntity, BudgetPeriodType } from "./budget_entity.types";
/**
 * Zod schema for the update_budget request payload.
 * All mutable fields are optional; at least one must be present.
 */
export declare const update_budget_input_schema: z.ZodObject<{
    idempotency_key: z.ZodString;
    budget_id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    amount: z.ZodOptional<z.ZodNumber>;
    category_ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
    alert_threshold: z.ZodOptional<z.ZodNumber>;
    is_ongoing: z.ZodOptional<z.ZodBoolean>;
    budget_end_date: z.ZodOptional<z.ZodString>;
    rollover_enabled: z.ZodOptional<z.ZodBoolean>;
    rollover_strategy: z.ZodOptional<z.ZodEnum<{
        immediate: "immediate";
        spread: "spread";
    }>>;
    rollover_spread_periods: z.ZodOptional<z.ZodNumber>;
    debug_mode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Validated wire payload type (inferred from the schema).
 */
export type UpdateBudgetInputData = z.infer<typeof update_budget_input_schema>;
/**
 * Normalized internal input passed to the orchestrator. Only the provided
 * fields are present (partial update semantics).
 */
export interface UpdateBudgetInput {
    budget_id: string;
    name?: string;
    description?: string;
    amount?: number;
    category_ids?: string[];
    alert_threshold?: number;
    is_ongoing?: boolean;
    budget_end_date?: string;
    rollover_enabled?: boolean;
    rollover_strategy?: "immediate" | "spread";
    rollover_spread_periods?: number;
}
/**
 * Dependencies resolved before updating a budget (read-only).
 */
export interface UpdateBudgetDependencies {
    /** The existing budget being updated */
    existing: BudgetEntity;
    /** Categories being added (claim from current owners) */
    added_category_ids: string[];
    /** Categories being removed (release back to Everything Else) */
    removed_category_ids: string[];
    /** The user's "Everything Else" budget ID, if one exists */
    everything_else_budget_id: string | null;
    /** Whether the amount changed (drives period re-allocation) */
    amount_changed: boolean;
}
/**
 * Pure input for the update_budget domain service.
 */
export interface UpdateBudgetComputeInput {
    user_id: string;
    input: UpdateBudgetInput;
    dependencies: UpdateBudgetDependencies;
    now: Timestamp;
}
/**
 * Payload for the process_budget_updated Cloud Tasks job.
 */
export interface ProcessBudgetUpdatedPayload {
    budget_id: string;
    user_id: string;
    group_ids: string[];
    budget_name: string;
    /** Denormalized onto every generated budget_period (self-contained periods). */
    category_ids: string[];
    amount: number;
    cadence: "weekly" | "monthly";
    /** Generation anchor (budget start) in epoch ms */
    start_ms: number;
    /** Generation horizon (12mo ahead for ongoing, budget end for limited) in ms */
    generation_end_ms: number;
    /** Whether this is an ongoing/recurring budget (drives extension flags) */
    is_recurring: boolean;
    /** Categories newly added to this budget (claim from prior owners) */
    added_claims: Array<{
        category_id: string;
        from_budget_id: string | null;
    }>;
    /** Categories removed from this budget (release to Everything Else) */
    released_category_ids: string[];
    everything_else_budget_id: string | null;
    /** Regenerate budget periods (amount changed) */
    regenerate_periods: boolean;
    /** The budget name changed — propagate budgetName to current+future periods */
    name_changed: boolean;
}
/**
 * Response returned to the client after updating a budget.
 */
export interface UpdateBudgetResponse {
    budget_id: string;
    name: string;
    amount: number;
    category_ids: string[];
    period: BudgetPeriodType;
    categories_claimed: number;
    categories_released: number;
    /** True when period re-allocation was deferred to a background job */
    processing_background: boolean;
}
/**
 * Orchestrator result wrapper.
 */
export interface UpdateBudgetOrchestratorResult {
    success: boolean;
    entity?: BudgetEntity;
    response?: UpdateBudgetResponse;
    errors?: string[];
}
/**
 * Fields that may be changed on the system "Everything Else" budget.
 * Everything else is computed automatically.
 */
export declare const EVERYTHING_ELSE_EDITABLE_FIELDS: ReadonlyArray<keyof UpdateBudgetInput>;
/** Performance budget for the update_budget orchestrator. */
export declare const UPDATE_BUDGET_BUDGET: {
    max_reads: number;
    max_writes: number;
    max_time_ms: number;
};
//# sourceMappingURL=update_budget.types.d.ts.map