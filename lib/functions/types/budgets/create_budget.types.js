"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREATE_BUDGET_BUDGET = exports.MAX_BUDGETS_PER_USER = exports.create_budget_input_schema = void 0;
const zod_1 = require("zod");
// ============================================================================
// Input Schema (wire format)
// ============================================================================
const BUDGET_PERIOD_VALUES = [
    "weekly",
    "monthly",
    "quarterly",
    "yearly",
    "custom",
];
/**
 * Zod schema for the create_budget request payload.
 * Validated in the entry layer.
 */
exports.create_budget_input_schema = zod_1.z
    .object({
    /** Idempotency key for safe retries */
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    name: zod_1.z.string().min(1, "name is required").max(100),
    description: zod_1.z.string().max(500).optional(),
    amount: zod_1.z.number().positive("amount must be positive"),
    category_ids: zod_1.z
        .array(zod_1.z.string().min(1))
        .min(1, "at least one category is required"),
    period: zod_1.z.enum(BUDGET_PERIOD_VALUES),
    budget_type: zod_1.z.enum(["recurring", "limited"]).optional(),
    /** ISO 8601 start date */
    start_date: zod_1.z.string().min(1, "start_date is required"),
    /** ISO 8601 end date (legacy, optional) */
    end_date: zod_1.z.string().optional(),
    alert_threshold: zod_1.z.number().min(0).max(100).optional(),
    is_shared: zod_1.z.boolean().optional(),
    /** Explicit group to share into; falls back to family for shared budgets */
    group_id: zod_1.z.string().optional(),
    selected_start_period: zod_1.z.string().optional(),
    is_ongoing: zod_1.z.boolean().optional(),
    /** ISO 8601 fixed end date; required when is_ongoing is false */
    budget_end_date: zod_1.z.string().optional(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((data) => data.is_ongoing !== false || !!data.budget_end_date, {
    message: "budget_end_date is required when is_ongoing is false",
    path: ["budget_end_date"],
});
// ============================================================================
// Constants
// ============================================================================
/** Maximum number of active budgets a user may own. */
exports.MAX_BUDGETS_PER_USER = 50;
/** Performance budget for the create_budget orchestrator. */
exports.CREATE_BUDGET_BUDGET = {
    max_reads: 15,
    max_writes: 5,
    max_time_ms: 1000,
};
//# sourceMappingURL=create_budget.types.js.map