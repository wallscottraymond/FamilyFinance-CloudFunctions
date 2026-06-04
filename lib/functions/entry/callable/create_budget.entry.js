"use strict";
/**
 * Create Budget Entry Point
 *
 * onCall entry for creating a budget in the layered architecture.
 *
 * @module entry/callable/create_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_budget = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const budgets_1 = require("../../orchestrators/budgets");
const types_1 = require("../../types");
const create_budget_types_1 = require("../../types/budgets/create_budget.types");
/**
 * Create a budget.
 */
exports.create_budget = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a, _b, _c, _d, _e;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "create_budget");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = create_budget_types_1.create_budget_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const data = validation.data;
        // Normalize wire payload → internal input (apply defaults)
        const input = {
            name: data.name,
            description: data.description,
            amount: data.amount,
            category_ids: data.category_ids,
            period: data.period,
            budget_type: (_b = data.budget_type) !== null && _b !== void 0 ? _b : "recurring",
            start_date: data.start_date,
            end_date: data.end_date,
            alert_threshold: (_c = data.alert_threshold) !== null && _c !== void 0 ? _c : 80,
            is_shared: (_d = data.is_shared) !== null && _d !== void 0 ? _d : false,
            group_id: data.group_id,
            selected_start_period: data.selected_start_period,
            is_ongoing: (_e = data.is_ongoing) !== null && _e !== void 0 ? _e : true,
            budget_end_date: data.budget_end_date,
        };
        const result = await (0, budgets_1.create_budget_orchestrator)(ctx, user_id, data.idempotency_key, input);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        return handle_entry_error(error, ctx, span, user_id);
    }
});
/**
 * Maps thrown errors to HttpsError. Shared shape across budget entries.
 */
function handle_entry_error(error, ctx, span, user_id) {
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
    throw new https_1.HttpsError("internal", "Failed to create budget", {
        trace_id: ctx.trace_id,
    });
}
//# sourceMappingURL=create_budget.entry.js.map