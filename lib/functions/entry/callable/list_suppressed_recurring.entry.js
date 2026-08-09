"use strict";
/**
 * List Suppressed Recurring Entry Point
 *
 * Read-only callable for the recovery screen: returns the user's currently
 * removed/paused recurring bills + income (with computed state). No input.
 *
 * @module entry/callable/list_suppressed_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.list_suppressed_recurring = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const list_suppressed_recurring_orchestrator_1 = require("../../orchestrators/recurring/list_suppressed_recurring.orchestrator");
const types_1 = require("../../types");
exports.list_suppressed_recurring = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "list_suppressed_recurring");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const result = await (0, list_suppressed_recurring_orchestrator_1.list_suppressed_recurring_orchestrator)(ctx, user_id, Date.now());
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw new https_1.HttpsError("internal", "Failed to list suppressed items", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=list_suppressed_recurring.entry.js.map