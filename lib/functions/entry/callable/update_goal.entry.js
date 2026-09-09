"use strict";
/**
 * Update Goal Entry Point — Goals (Phase 1)
 *
 * @module entry/callable/update_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.update_goal = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const goals_1 = require("../../orchestrators/goals");
const types_1 = require("../../types");
const goal_crud_types_1 = require("../../types/goals/goal_crud.types");
const create_goal_entry_1 = require("./create_goal.entry");
exports.update_goal = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "update_goal");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = goal_crud_types_1.update_goal_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const data = validation.data;
        const input = {
            goal_id: data.goal_id,
            name: data.name,
            target_amount: data.target_amount,
            end_date: data.end_date,
            home_cadence: data.home_cadence,
            per_period_amount: data.per_period_amount,
            priority_rank: data.priority_rank,
            status: data.status,
            linked_recurring_id: data.linked_recurring_id,
            apr: data.apr,
            minimum_payment: data.minimum_payment,
            extra_principal: data.extra_principal,
        };
        const result = await (0, goals_1.update_goal_orchestrator)(ctx, user_id, data.idempotency_key, input);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        return (0, create_goal_entry_1.handle_goal_entry_error)(error, ctx, span, user_id, "update goal");
    }
});
//# sourceMappingURL=update_goal.entry.js.map