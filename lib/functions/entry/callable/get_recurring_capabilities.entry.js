"use strict";
/**
 * Get Recurring Capabilities Entry Point (Convert-To-Recurring Phase 2): tells the app whether the
 * convert features are on for the caller (the app can't read `_feature_flags`). Returns only
 * `{enabled}`.
 *
 * @module entry/callable/get_recurring_capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_recurring_capabilities = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const get_recurring_capabilities_orchestrator_1 = require("../../orchestrators/recurring/get_recurring_capabilities.orchestrator");
const types_1 = require("../../types");
exports.get_recurring_capabilities = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const span = (0, observability_1.create_span)(ctx, "entry", "get_recurring_capabilities");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const result = await (0, get_recurring_capabilities_orchestrator_1.get_recurring_capabilities_orchestrator)(ctx, user_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw new https_1.HttpsError("internal", "Failed to read capabilities", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=get_recurring_capabilities.entry.js.map