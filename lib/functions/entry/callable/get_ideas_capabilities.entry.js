"use strict";
/**
 * Get Ideas Capabilities Entry Point (Planning-Module v1): tells the app whether Ideas is on for
 * the caller (the app can't read `_feature_flags`). Returns only `{enabled}`.
 *
 * @module entry/callable/get_ideas_capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_ideas_capabilities = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const idea_orchestrator_1 = require("../../orchestrators/ideas/idea.orchestrator");
const types_1 = require("../../types");
exports.get_ideas_capabilities = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const span = (0, observability_1.create_span)(ctx, "entry", "get_ideas_capabilities");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const result = await (0, idea_orchestrator_1.get_ideas_capabilities_orchestrator)(ctx, user_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        (0, observability_1.log_operation_error)(span, err, { user_id });
        throw new https_1.HttpsError("internal", "Failed to read capabilities", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=get_ideas_capabilities.entry.js.map