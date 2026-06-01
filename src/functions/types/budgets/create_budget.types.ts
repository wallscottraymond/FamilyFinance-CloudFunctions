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
import {
  BudgetEntity,
  BudgetPeriodType,
  BudgetType,
} from "./budget_entity.types";

// ============================================================================
// Input Schema (wire format)
// ============================================================================

const BUDGET_PERIOD_VALUES = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
] as const;

/**
 * Zod schema for the create_budget request payload.
 * Validated in the entry layer.
 */
export const create_budget_input_schema = z
  .object({
    /** Idempotency key for safe retries */
    idempotency_key: z.string().min(1, "idempotency_key is required"),
    name: z.string().min(1, "name is required").max(100),
    description: z.string().max(500).optional(),
    amount: z.number().positive("amount must be positive"),
    category_ids: z
      .array(z.string().min(1))
      .min(1, "at least one category is required"),
    period: z.enum(BUDGET_PERIOD_VALUES),
    budget_type: z.enum(["recurring", "limited"]).optional(),
    /** ISO 8601 start date */
    start_date: z.string().min(1, "start_date is required"),
    /** ISO 8601 end date (legacy, optional) */
    end_date: z.string().optional(),
    alert_threshold: z.number().min(0).max(100).optional(),
    is_shared: z.boolean().optional(),
    /** Explicit group to share into; falls back to family for shared budgets */
    group_id: z.string().optional(),
    selected_start_period: z.string().optional(),
    is_ongoing: z.boolean().optional(),
    /** ISO 8601 fixed end date; required when is_ongoing is false */
    budget_end_date: z.string().optional(),
    debug_mode: z.boolean().optional(),
  })
  .refine(
    (data) => data.is_ongoing !== false || !!data.budget_end_date,
    {
      message: "budget_end_date is required when is_ongoing is false",
      path: ["budget_end_date"],
    }
  );

/**
 * Validated wire payload type (inferred from the schema).
 */
export type CreateBudgetInputData = z.infer<typeof create_budget_input_schema>;

// ============================================================================
// Internal Input (normalized by entry)
// ============================================================================

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

// ============================================================================
// Resolver Types
// ============================================================================

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

// ============================================================================
// Domain Service Types
// ============================================================================

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

// ============================================================================
// Job Payload Types
// ============================================================================

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

// ============================================================================
// Output Types
// ============================================================================

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

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of active budgets a user may own. */
export const MAX_BUDGETS_PER_USER = 50;

/** Performance budget for the create_budget orchestrator. */
export const CREATE_BUDGET_BUDGET = {
  max_reads: 15,
  max_writes: 5,
  max_time_ms: 1000,
};
