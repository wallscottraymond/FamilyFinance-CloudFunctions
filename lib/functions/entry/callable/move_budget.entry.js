"use strict";
/**
 * Move Budget Entry Point (Account-Rooted-Sharing)
 *
 * Moves a budget between Me and a group (D9): its settings and history come along.
 *
 * @module entry/callable/move_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.move_budget = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const budget_view_orchestrator_1 = require("../../orchestrators/sharing/budget_view.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    budget_id: zod_1.z.string().trim().min(1).max(128),
    /** null / absent = move to Me */
    to_group_id: zod_1.z.string().trim().min(1).max(128).nullable().optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Moves a budget between Me and a group (D9): its settings and history come along.
 */
exports.move_budget = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "move_budget");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
        (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
            user_id,
            error_code: "VALIDATION_ERROR",
        });
        return (0, types_1.error_response)("VALIDATION_ERROR", validation.error.issues.map((i) => i.message).join("; "), trace.trace_id);
    }
    try {
        const result = await (0, budget_view_orchestrator_1.move_budget_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                budget_id: validation.data.budget_id,
                to_group_id: (_b = validation.data.to_group_id) !== null && _b !== void 0 ? _b : null,
            }, user_id, idempotency_key: `move_budget:${trace.trace_id}` }));
        if (!result.success) {
            return (0, types_1.error_response)("VALIDATION_ERROR", ((_c = result.errors) !== null && _c !== void 0 ? _c : ["Not allowed"]).join("; "), trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to move the budget. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=move_budget.entry.js.map