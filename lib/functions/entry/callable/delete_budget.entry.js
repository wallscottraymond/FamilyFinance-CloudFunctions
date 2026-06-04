"use strict";
/**
 * Delete Budget Entry Point
 *
 * onCall entry for deleting a budget. Replaces the legacy onRequest HTTP
 * deleteBudget function.
 *
 * @module entry/callable/delete_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_budget = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const budgets_1 = require("../../orchestrators/budgets");
const types_1 = require("../../types");
const delete_budget_types_1 = require("../../types/budgets/delete_budget.types");
/**
 * Delete a budget.
 */
exports.delete_budget = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "delete_budget");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = delete_budget_types_1.delete_budget_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const data = validation.data;
        const result = await (0, budgets_1.delete_budget_orchestrator)(ctx, user_id, data.idempotency_key, data.budget_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id, code: error.code });
        }
        if (error instanceof Error &&
            error.message === "Request already in progress") {
            throw new https_1.HttpsError("aborted", "This action is already in progress. Please wait.", { trace_id: ctx.trace_id });
        }
        throw new https_1.HttpsError("internal", "Failed to delete budget", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=delete_budget.entry.js.map