"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELETE_BUDGET_BUDGET = exports.delete_budget_input_schema = void 0;
const zod_1 = require("zod");
// ============================================================================
// Input Schema (wire format)
// ============================================================================
/**
 * Zod schema for the delete_budget request payload.
 */
exports.delete_budget_input_schema = zod_1.z.object({
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    budget_id: zod_1.z.string().min(1, "budget_id is required"),
    debug_mode: zod_1.z.boolean().optional(),
});
// ============================================================================
// Constants
// ============================================================================
/** Performance budget for the delete_budget orchestrator (sync path only). */
exports.DELETE_BUDGET_BUDGET = {
    max_reads: 20,
    max_writes: 5,
    max_time_ms: 1500,
};
//# sourceMappingURL=delete_budget.types.js.map