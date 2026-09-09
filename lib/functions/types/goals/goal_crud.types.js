"use strict";
/**
 * Goal CRUD Types — Goals (Phase 1)
 *
 * Zod schemas (wire format, snake_case) + normalized inputs/responses for the
 * create/update/delete_goal callables. Validated in the entry layer, then
 * normalized into the internal inputs the orchestrators consume.
 *
 * @module types/goals/goal_crud
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_goal_input_schema = exports.update_goal_input_schema = exports.create_goal_input_schema = void 0;
const zod_1 = require("zod");
const GOAL_TYPE_VALUES = [
    "debt_paydown",
    "big_purchase",
    "savings",
    "invest",
];
const GOAL_CADENCE_VALUES = ["weekly", "monthly", "bi_monthly"];
// ============================================================================
// Create
// ============================================================================
exports.create_goal_input_schema = zod_1.z
    .object({
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    goal_type: zod_1.z.enum(GOAL_TYPE_VALUES),
    name: zod_1.z.string().min(1, "name is required").max(100),
    linked_account_id: zod_1.z.string().min(1, "linked_account_id is required"),
    /** Required for big_purchase + debt_paydown; omit for ongoing savings/invest. */
    target_amount: zod_1.z.number().positive().optional(),
    /** ISO 8601; omit for ongoing. */
    end_date: zod_1.z.string().optional(),
    home_cadence: zod_1.z.enum(GOAL_CADENCE_VALUES),
    per_period_amount: zod_1.z.number().positive("per_period_amount must be positive"),
    /** Does the account's current balance count toward the target? (per-goal baseline) */
    baseline_counts_existing: zod_1.z.boolean().optional(),
    is_shared: zod_1.z.boolean().optional(),
    group_id: zod_1.z.string().optional(),
    // Debt-only
    linked_recurring_id: zod_1.z.string().optional(),
    apr: zod_1.z.number().min(0).max(100).optional(),
    minimum_payment: zod_1.z.number().min(0).optional(),
    extra_principal: zod_1.z.number().min(0).optional(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((d) => (d.goal_type !== "big_purchase" && d.goal_type !== "debt_paydown") ||
    (d.target_amount != null && d.target_amount > 0), {
    message: "target_amount is required for big_purchase and debt_paydown goals",
    path: ["target_amount"],
});
// ============================================================================
// Update
// ============================================================================
exports.update_goal_input_schema = zod_1.z.object({
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    goal_id: zod_1.z.string().min(1, "goal_id is required"),
    name: zod_1.z.string().min(1).max(100).optional(),
    target_amount: zod_1.z.number().positive().nullable().optional(),
    end_date: zod_1.z.string().nullable().optional(),
    home_cadence: zod_1.z.enum(GOAL_CADENCE_VALUES).optional(),
    per_period_amount: zod_1.z.number().positive().optional(),
    priority_rank: zod_1.z.number().int().min(0).optional(),
    status: zod_1.z.enum(["active", "paused", "completed", "archived"]).optional(),
    linked_recurring_id: zod_1.z.string().nullable().optional(),
    apr: zod_1.z.number().min(0).max(100).nullable().optional(),
    minimum_payment: zod_1.z.number().min(0).nullable().optional(),
    extra_principal: zod_1.z.number().min(0).nullable().optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
// ============================================================================
// Delete
// ============================================================================
exports.delete_goal_input_schema = zod_1.z.object({
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    goal_id: zod_1.z.string().min(1, "goal_id is required"),
    debug_mode: zod_1.z.boolean().optional(),
});
//# sourceMappingURL=goal_crud.types.js.map