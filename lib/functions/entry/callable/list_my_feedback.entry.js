"use strict";
/**
 * list_my_feedback — the caller's own sent notes, newest first (the Sent tab).
 *
 * @module entry/callable/list_my_feedback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.list_my_feedback = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const feedback_orchestrator_1 = require("../../orchestrators/feedback/feedback.orchestrator");
const types_1 = require("../../types");
exports.list_my_feedback = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "list_my_feedback");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const result = await (0, feedback_orchestrator_1.list_my_feedback_orchestrator)(trace, user_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
            error_code: "INTERNAL_ERROR",
        });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to load. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=list_my_feedback.entry.js.map