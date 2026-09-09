"use strict";
/**
 * Derive Goals View Entry Point — Goals (Phase 1)
 *
 * onCall read endpoint for the period-page Goals section: given a period_id,
 * returns each active goal + its measured progress for that period. Read-only.
 *
 * @module entry/callable/derive_goals_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_goals_view = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const goals_1 = require("../../orchestrators/goals");
const types_1 = require("../../types");
const create_goal_entry_1 = require("./create_goal.entry");
const derive_goals_view_input_schema = zod_1.z.object({
    period_id: zod_1.z.string().min(1, "period_id is required"),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.derive_goals_view = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_goals_view");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = derive_goals_view_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const result = await (0, goals_1.derive_goals_view_orchestrator)(ctx, user_id, validation.data.period_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        return (0, create_goal_entry_1.handle_goal_entry_error)(error, ctx, span, user_id, "load goals");
    }
});
//# sourceMappingURL=derive_goals_view.entry.js.map