/**
 * Goal CRUD Types — Goals (Phase 1)
 *
 * Zod schemas (wire format, snake_case) + normalized inputs/responses for the
 * create/update/delete_goal callables. Validated in the entry layer, then
 * normalized into the internal inputs the orchestrators consume.
 *
 * @module types/goals/goal_crud
 */

import { z } from "zod";
import { GoalType, GoalCadence, GoalStatus } from "./goal_entity.types";

const GOAL_TYPE_VALUES = [
  "debt_paydown",
  "big_purchase",
  "savings",
  "invest",
] as const;

const GOAL_CADENCE_VALUES = ["weekly", "monthly", "bi_monthly"] as const;

// ============================================================================
// Create
// ============================================================================

export const create_goal_input_schema = z
  .object({
    idempotency_key: z.string().min(1, "idempotency_key is required"),
    goal_type: z.enum(GOAL_TYPE_VALUES),
    name: z.string().min(1, "name is required").max(100),
    linked_account_id: z.string().min(1, "linked_account_id is required"),
    /** Required for big_purchase + debt_paydown; omit for ongoing savings/invest. */
    target_amount: z.number().positive().optional(),
    /** ISO 8601; omit for ongoing. */
    end_date: z.string().optional(),
    home_cadence: z.enum(GOAL_CADENCE_VALUES),
    per_period_amount: z.number().positive("per_period_amount must be positive"),
    /** Does the account's current balance count toward the target? (per-goal baseline) */
    baseline_counts_existing: z.boolean().optional(),
    is_shared: z.boolean().optional(),
    group_id: z.string().optional(),
    // Debt-only
    linked_recurring_id: z.string().optional(),
    apr: z.number().min(0).max(100).optional(),
    minimum_payment: z.number().min(0).optional(),
    extra_principal: z.number().min(0).optional(),
    debug_mode: z.boolean().optional(),
  })
  .refine(
    (d) =>
      (d.goal_type !== "big_purchase" && d.goal_type !== "debt_paydown") ||
      (d.target_amount != null && d.target_amount > 0),
    {
      message: "target_amount is required for big_purchase and debt_paydown goals",
      path: ["target_amount"],
    }
  );

export type CreateGoalInputData = z.infer<typeof create_goal_input_schema>;

/** Normalized internal input passed to the orchestrator. */
export interface CreateGoalInput {
  goal_type: GoalType;
  name: string;
  linked_account_id: string;
  target_amount?: number | null;
  end_date?: string | null;
  home_cadence: GoalCadence;
  per_period_amount: number;
  baseline_counts_existing: boolean;
  is_shared: boolean;
  group_id?: string;
  linked_recurring_id?: string | null;
  apr?: number | null;
  minimum_payment?: number | null;
  extra_principal?: number | null;
}

export interface CreateGoalResponse {
  goal_id: string;
  goal_type: GoalType;
  name: string;
  linked_account_id: string;
  target_amount?: number | null;
  per_period_amount: number;
  home_cadence: GoalCadence;
  priority_rank: number;
  baseline_balance: number;
}

// ============================================================================
// Update
// ============================================================================

export const update_goal_input_schema = z.object({
  idempotency_key: z.string().min(1, "idempotency_key is required"),
  goal_id: z.string().min(1, "goal_id is required"),
  name: z.string().min(1).max(100).optional(),
  target_amount: z.number().positive().nullable().optional(),
  end_date: z.string().nullable().optional(),
  home_cadence: z.enum(GOAL_CADENCE_VALUES).optional(),
  per_period_amount: z.number().positive().optional(),
  priority_rank: z.number().int().min(0).optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
  linked_recurring_id: z.string().nullable().optional(),
  apr: z.number().min(0).max(100).nullable().optional(),
  minimum_payment: z.number().min(0).nullable().optional(),
  extra_principal: z.number().min(0).nullable().optional(),
  debug_mode: z.boolean().optional(),
});

export type UpdateGoalInputData = z.infer<typeof update_goal_input_schema>;

/** Fields a client may patch. `undefined` = leave unchanged; `null` = clear. */
export interface UpdateGoalInput {
  goal_id: string;
  name?: string;
  target_amount?: number | null;
  end_date?: string | null;
  home_cadence?: GoalCadence;
  per_period_amount?: number;
  priority_rank?: number;
  status?: GoalStatus;
  linked_recurring_id?: string | null;
  apr?: number | null;
  minimum_payment?: number | null;
  extra_principal?: number | null;
}

export interface UpdateGoalResponse {
  goal_id: string;
  updated: boolean;
}

// ============================================================================
// Delete
// ============================================================================

export const delete_goal_input_schema = z.object({
  idempotency_key: z.string().min(1, "idempotency_key is required"),
  goal_id: z.string().min(1, "goal_id is required"),
  debug_mode: z.boolean().optional(),
});

export type DeleteGoalInputData = z.infer<typeof delete_goal_input_schema>;

export interface DeleteGoalResponse {
  goal_id: string;
  deleted: boolean;
}
