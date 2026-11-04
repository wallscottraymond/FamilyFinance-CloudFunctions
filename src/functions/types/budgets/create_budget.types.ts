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
import { CHECKLIST_MAX_ITEMS } from "../../domain/budgets/budget_checklist.service";

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
    category_ids: z.array(z.string().min(1)),
    /** Manual Transaction Adding (AF-02): no categories; only what the user puts in it counts. */
    is_manual: z.boolean().optional(),
    /** A Fund: one total until it ends. Needs an end date; only what's assigned to it counts. */
    is_fund: z.boolean().optional(),
    /** Checklist items entered while creating the budget. */
    checklist_items: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          name: z.string().trim().min(1, "Give each list item a name").max(100),
          estimate: z.number().min(0).max(100_000_000),
        })
      )
      .max(CHECKLIST_MAX_ITEMS, `A checklist can hold up to ${CHECKLIST_MAX_ITEMS} items`)
      .optional(),
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
    /** Account-Rooted-Sharing: create the budget in this group's view (caller must be a member). */
    view_group_id: z.string().trim().min(1).max(128).optional(),
    selected_start_period: z.string().optional(),
    is_ongoing: z.boolean().optional(),
    /** ISO 8601 fixed end date; required when is_ongoing is false */
    budget_end_date: z.string().optional(),
    debug_mode: z.boolean().optional(),
  })
  .refine((data) => data.is_manual === true || data.category_ids.length > 0, {
    message: "at least one category is required",
    path: ["category_ids"],
  })
  .refine((data) => data.is_fund !== true || !!data.budget_end_date, {
    message: "A fund needs an end date",
    path: ["budget_end_date"],
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
  is_manual?: boolean;
  is_fund?: boolean;
  checklist_items?: Array<{ id: string; name: string; estimate: number }>;
  period: BudgetPeriodType;
  budget_type: BudgetType;
  start_date: string;
  end_date?: string;
  alert_threshold: number;
  is_shared: boolean;
  group_id?: string;
  /** Account-Rooted-Sharing (PD6): create in this group's view instead of Me. */
  view_group_id?: string;
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
  /** The user's "Everything Else" budget ID, if one exists */
  everything_else_budget_id: string | null;
  /** The view's budgets (same owner key) — who owns what, per view (canon A3). */
  view_budgets: Array<{
    id: string;
    name: string;
    category_ids: string[];
    is_everything_else: boolean;
    start_ms: number;
  }>;
  /** category id (slug or legacy Plaid code) → the first category it means. */
  first_by_category: Record<string, string>;
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
  /** Owner key: the creator's uid, or "group:<id>" for a group budget (PD6). */
  user_id: string;
  /** The person creating it (defaults to user_id). */
  created_by?: string;
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
  is_fund?: boolean;
  user_id: string;
  group_ids: string[];
  budget_name: string;
  /** Denormalized onto every generated budget_period (self-contained periods). */
  category_ids: string[];
  /** Per PRIME period (`budget_amount_per_instance`): a yearly budget's monthly share. */
  amount: number;
  /** Budget cadence mapped to a period instance base (weekly | monthly | bi_monthly) */
  cadence: "weekly" | "monthly" | "bi_monthly";
  /** Generation anchor (budget start) in epoch ms */
  start_ms: number;
  /** Generation horizon (12mo ahead for ongoing, budget end for limited) in ms */
  generation_end_ms: number;
  /** Whether this is an ongoing/recurring budget (drives extension flags) */
  is_recurring: boolean;
  claims: CategoryClaim[];
  everything_else_budget_id: string | null;
  /** Re-assign the view's transactions from here (earliest start of this + source budgets). */
  rehome_from_ms?: number;
  /**
   * When true, generate ONLY prime periods (skip non-prime). Used by the
   * per-lens Everything Else budgets, which must appear in their OWN period view
   * only — a non-prime EE period would double-count against another lens's EE.
   */
  prime_only?: boolean;
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
