/**
 * Create Budget Types
 *
 * Types and Zod schema for the create_budget flow in the 5-layer architecture.
 *
 * Wire format is snake_case (clients send snake_case payloads, consistent with
 * the Plaid reference). The entry layer validates with the Zod schema, then
 * normalizes into the internal input passed to the orchestrator.
 *
 * @module types/budgets/create_budget
 */
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { BudgetEntity, BudgetPeriodType, BudgetType } from "./budget_entity.types";
/**
 * Zod schema for the create_budget request payload.
 * Validated in the entry layer.
 */
export declare const create_budget_input_schema: z.ZodObject<{
    idempotency_key: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    amount: z.ZodNumber;
    category_ids: z.ZodArray<z.ZodString>;
    period: z.ZodEnum<{
        weekly: "weekly";
        monthly: "monthly";
        yearly: "yearly";
        quarterly: "quarterly";
        custom: "custom";
    }>;
    budget_type: z.ZodOptional<z.ZodEnum<{
        recurring: "recurring";
        limited: "limited";
    }>>;
    start_date: z.ZodString;
    end_date: z.ZodOptional<z.ZodString>;
    alert_threshold: z.ZodOptional<z.ZodNumber>;
    is_shared: z.ZodOptional<z.ZodBoolean>;
    group_id: z.ZodOptional<z.ZodString>;
    selected_start_period: z.ZodOptional<z.ZodString>;
    is_ongoing: z.ZodOptional<z.ZodBoolean>;
    budget_end_date: z.ZodOptional<z.ZodString>;
    debug_mode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Validated wire payload type (inferred from the schema).
 */
export type CreateBudgetInputData = z.infer<typeof create_budget_input_schema>;
/**
 * Normalized internal input passed to the orchestrator.
 * Dates are still ISO strings here; the domain service converts them to
 * Timestamps as part of pure computation.
 */
export interface CreateBudgetInput {
    name: string;
    description?: string;
    amount: number;
    category_ids: string[];
    period: BudgetPeriodType;
    budget_type: BudgetType;
    start_date: string;
    end_date?: string;
    alert_threshold: number;
    is_shared: boolean;
    group_id?: string;
    selected_start_period?: string;
    is_ongoing: boolean;
    budget_end_date?: string;
}
/**
 * Dependencies resolved before creating a budget (read-only).
 */
export interface CreateBudgetDependencies {
    /** Currency to apply (from family settings or user preferences) */
    currency: string;
    /** Group IDs the budget will belong to */
    group_ids: string[];
    /** Number of budgets the user already owns (for the 50-budget limit) */
    existing_budget_count: number;
    /** Map of requested category_id → current owner budget_id (null = unassigned) */
    category_owners: Record<string, string | null>;
    /** The user's "Everything Else" budget ID, if one exists */
    everything_else_budget_id: string | null;
}
/**
 * Pure input for the create_budget domain service. Combines normalized client
 * input with resolved dependencies and identity, plus a deterministic clock.
 */
export interface CreateBudgetComputeInput {
    budget_id: string;
    user_id: string;
    input: CreateBudgetInput;
    dependencies: CreateBudgetDependencies;
    now: Timestamp;
}
/**
 * A single category claim carried to the cascade job.
 */
export interface CategoryClaim {
    category_id: string;
    from_budget_id: string | null;
}
/**
 * Payload for the process_budget_created Cloud Tasks job.
 */
export interface ProcessBudgetCreatedPayload {
    budget_id: string;
    user_id: string;
    group_ids: string[];
    budget_name: string;
    /** Denormalized onto every generated budget_period (self-contained periods). */
    category_ids: string[];
    amount: number;
    /** Budget cadence mapped to a period instance base (weekly | monthly) */
    cadence: "weekly" | "monthly";
    /** Generation anchor (budget start) in epoch ms */
    start_ms: number;
    /** Generation horizon (12mo ahead for ongoing, budget end for limited) in ms */
    generation_end_ms: number;
    /** Whether this is an ongoing/recurring budget (drives extension flags) */
    is_recurring: boolean;
    claims: CategoryClaim[];
    everything_else_budget_id: string | null;
}
/**
 * Response returned to the client after creating a budget.
 */
export interface CreateBudgetResponse {
    budget_id: string;
    name: string;
    amount: number;
    currency: string;
    category_ids: string[];
    period: BudgetPeriodType;
    is_shared: boolean;
    /** Categories transferred to this budget from prior owners */
    categories_claimed: number;
    /** True when period generation was deferred to a background job */
    processing_background: boolean;
}
/**
 * Orchestrator result wrapper.
 */
export interface CreateBudgetOrchestratorResult {
    success: boolean;
    entity?: BudgetEntity;
    response?: CreateBudgetResponse;
    errors?: string[];
}
/** Maximum number of active budgets a user may own. */
export declare const MAX_BUDGETS_PER_USER = 50;
/** Performance budget for the create_budget orchestrator. */
export declare const CREATE_BUDGET_BUDGET: {
    max_reads: number;
    max_writes: number;
    max_time_ms: number;
};
//# sourceMappingURL=create_budget.types.d.ts.map