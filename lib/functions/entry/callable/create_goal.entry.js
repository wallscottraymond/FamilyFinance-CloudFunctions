"use strict";
/**
 * Create Goal Entry Point — Goals (Phase 1)
 *
 * onCall entry for creating a goal in the layered architecture.
 *
 * @module entry/callable/create_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_goal = void 0;
exports.handle_goal_entry_error = handle_goal_entry_error;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const goals_1 = require("../../orchestrators/goals");
const types_1 = require("../../types");
const goal_crud_types_1 = require("../../types/goals/goal_crud.types");
exports.create_goal = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "create_goal");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = goal_crud_types_1.create_goal_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const data = validation.data;
        const input = {
            goal_type: data.goal_type,
            name: data.name,
            linked_account_id: data.linked_account_id,
            target_amount: (_b = data.target_amount) !== null && _b !== void 0 ? _b : null,
            end_date: (_c = data.end_date) !== null && _c !== void 0 ? _c : null,
            home_cadence: data.home_cadence,
            per_period_amount: data.per_period_amount,
            baseline_counts_existing: (_d = data.baseline_counts_existing) !== null && _d !== void 0 ? _d : false,
            is_shared: (_e = data.is_shared) !== null && _e !== void 0 ? _e : false,
            group_id: data.group_id,
            linked_recurring_id: (_f = data.linked_recurring_id) !== null && _f !== void 0 ? _f : null,
            apr: (_g = data.apr) !== null && _g !== void 0 ? _g : null,
            minimum_payment: (_h = data.minimum_payment) !== null && _h !== void 0 ? _h : null,
            extra_principal: (_j = data.extra_principal) !== null && _j !== void 0 ? _j : null,
        };
        const result = await (0, goals_1.create_goal_orchestrator)(ctx, user_id, data.idempotency_key, input);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        return handle_goal_entry_error(error, ctx, span, user_id, "create goal");
    }
});
/** Maps thrown errors to HttpsError. Shared across goal entries. */
function handle_goal_entry_error(error, ctx, span, user_id, action) {
    (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    if (error instanceof https_1.HttpsError) {
        throw error;
    }
    if (error instanceof types_1.DomainError) {
        throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id, code: error.code });
    }
    if (error instanceof Error && error.message === "Request already in progress") {
        throw new https_1.HttpsError("aborted", "This action is already in progress. Please wait.", { trace_id: ctx.trace_id });
    }
    throw new https_1.HttpsError("internal", `Failed to ${action}`, {
        trace_id: ctx.trace_id,
    });
}
//# sourceMappingURL=create_goal.entry.js.map