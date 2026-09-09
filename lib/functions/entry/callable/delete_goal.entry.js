"use strict";
/**
 * Delete Goal Entry Point — Goals (Phase 1)
 *
 * @module entry/callable/delete_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_goal = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const goals_1 = require("../../orchestrators/goals");
const types_1 = require("../../types");
const goal_crud_types_1 = require("../../types/goals/goal_crud.types");
const create_goal_entry_1 = require("./create_goal.entry");
exports.delete_goal = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "delete_goal");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = goal_crud_types_1.delete_goal_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const data = validation.data;
        const result = await (0, goals_1.delete_goal_orchestrator)(ctx, user_id, data.idempotency_key, data.goal_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        return (0, create_goal_entry_1.handle_goal_entry_error)(error, ctx, span, user_id, "delete goal");
    }
});
//# sourceMappingURL=delete_goal.entry.js.map