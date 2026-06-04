"use strict";
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATE_BUDGET_BUDGET = exports.EVERYTHING_ELSE_EDITABLE_FIELDS = exports.update_budget_input_schema = void 0;
const zod_1 = require("zod");
// ============================================================================
// Input Schema (wire format)
// ============================================================================
/**
 * Zod schema for the update_budget request payload.
 * All mutable fields are optional; at least one must be present.
 */
exports.update_budget_input_schema = zod_1.z
    .object({
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    budget_id: zod_1.z.string().min(1, "budget_id is required"),
    name: zod_1.z.string().min(1).max(100).optional(),
    description: zod_1.z.string().max(500).optional(),
    amount: zod_1.z.number().positive().optional(),
    category_ids: zod_1.z.array(zod_1.z.string().min(1)).min(1).optional(),
    alert_threshold: zod_1.z.number().min(0).max(100).optional(),
    is_ongoing: zod_1.z.boolean().optional(),
    budget_end_date: zod_1.z.string().optional(),
    rollover_enabled: zod_1.z.boolean().optional(),
    rollover_strategy: zod_1.z.enum(["immediate", "spread"]).optional(),
    rollover_spread_periods: zod_1.z.number().int().min(1).max(6).optional(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((data) => {
    const { idempotency_key, budget_id, debug_mode } = data, mutable = __rest(data, ["idempotency_key", "budget_id", "debug_mode"]);
    void idempotency_key;
    void budget_id;
    void debug_mode;
    return Object.values(mutable).some((v) => v !== undefined);
}, { message: "at least one field to update is required" });
// ============================================================================
// Constants
// ============================================================================
/**
 * Fields that may be changed on the system "Everything Else" budget.
 * Everything else is computed automatically.
 */
exports.EVERYTHING_ELSE_EDITABLE_FIELDS = ["name"];
/** Performance budget for the update_budget orchestrator. */
exports.UPDATE_BUDGET_BUDGET = {
    max_reads: 15,
    max_writes: 5,
    max_time_ms: 1000,
};
//# sourceMappingURL=update_budget.types.js.map