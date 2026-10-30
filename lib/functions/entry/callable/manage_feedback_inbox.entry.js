"use strict";
/**
 * manage_feedback_inbox — the owner-only Feedback Inbox (D10): list (by status, optional type),
 * mark read, open / done, delete. Anyone else gets PERMISSION_DENIED.
 *
 * @module entry/callable/manage_feedback_inbox
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manage_feedback_inbox = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const feedback_orchestrator_1 = require("../../orchestrators/feedback/feedback.orchestrator");
const types_1 = require("../../types");
const feedback_types_1 = require("../../types/feedback.types");
exports.manage_feedback_inbox = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 10 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "manage_feedback_inbox");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = feedback_types_1.feedback_inbox_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
            user_id,
            error_code: "VALIDATION_ERROR",
        });
        return (0, types_1.error_response)("VALIDATION_ERROR", validation.error.issues.map((i) => i.message).join("; "), trace.trace_id);
    }
    try {
        const outcome = await (0, feedback_orchestrator_1.feedback_inbox_orchestrator)(Object.assign(Object.assign({}, trace), { input: validation.data, user_id, idempotency_key: `manage_feedback_inbox:${trace.trace_id}` }));
        if (!outcome.success) {
            (0, observability_1.log_operation_error)(span, new Error(outcome.code), { user_id, error_code: outcome.code });
            return (0, types_1.error_response)(outcome.code, outcome.message, trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(outcome.data, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
            error_code: "INTERNAL_ERROR",
        });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to update. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=manage_feedback_inbox.entry.js.map