"use strict";
/**
 * get_feedback_status — is the caller a Feedback Inbox owner, and (owner only) how many notes are
 * unread. A non-owner gets `is_owner: false` (never an error), which keeps the inbox row hidden.
 *
 * @module entry/callable/get_feedback_status
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_feedback_status = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const feedback_orchestrator_1 = require("../../orchestrators/feedback/feedback.orchestrator");
const types_1 = require("../../types");
exports.get_feedback_status = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "get_feedback_status");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const result = await (0, feedback_orchestrator_1.feedback_status_orchestrator)(trace, user_id);
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
//# sourceMappingURL=get_feedback_status.entry.js.map