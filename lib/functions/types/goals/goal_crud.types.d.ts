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
export declare const create_goal_input_schema: z.ZodObject<{
    idempotency_key: z.ZodString;
    goal_type: z.ZodEnum<{
        savings: "savings";
        debt_paydown: "debt_paydown";
        big_purchase: "big_purchase";
        invest: "invest";
    }>;
    name: z.ZodString;
    linked_account_id: z.ZodString;
    target_amount: z.ZodOptional<z.ZodNumber>;
    end_date: z.ZodOptional<z.ZodString>;
    home_cadence: z.ZodEnum<{
        weekly: "weekly";
        monthly: "monthly";
        bi_monthly: "bi_monthly";
    }>;
    per_period_amount: z.ZodNumber;
    baseline_counts_existing: z.ZodOptional<z.ZodBoolean>;
    is_shared: z.ZodOptional<z.ZodBoolean>;
    group_id: z.ZodOptional<z.ZodString>;
    linked_recurring_id: z.ZodOptional<z.ZodString>;
    apr: z.ZodOptional<z.ZodNumber>;
    minimum_payment: z.ZodOptional<z.ZodNumber>;
    extra_principal: z.ZodOptional<z.ZodNumber>;
    debug_mode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
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
export declare const update_goal_input_schema: z.ZodObject<{
    idempotency_key: z.ZodString;
    goal_id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    target_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    end_date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    home_cadence: z.ZodOptional<z.ZodEnum<{
        weekly: "weekly";
        monthly: "monthly";
        bi_monthly: "bi_monthly";
    }>>;
    per_period_amount: z.ZodOptional<z.ZodNumber>;
    priority_rank: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        completed: "completed";
        paused: "paused";
        archived: "archived";
    }>>;
    linked_recurring_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    apr: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    minimum_payment: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    extra_principal: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    debug_mode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
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
export declare const delete_goal_input_schema: z.ZodObject<{
    idempotency_key: z.ZodString;
    goal_id: z.ZodString;
    debug_mode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type DeleteGoalInputData = z.infer<typeof delete_goal_input_schema>;
export interface DeleteGoalResponse {
    goal_id: string;
    deleted: boolean;
}
//# sourceMappingURL=goal_crud.types.d.ts.map