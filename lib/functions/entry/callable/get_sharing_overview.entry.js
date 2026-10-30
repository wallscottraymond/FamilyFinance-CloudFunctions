"use strict";
/**
 * Get Sharing Overview Entry Point (Account-Rooted-Sharing)
 *
 * Everything the Groups screen shows: groups, connected people, requests, limits.
 *
 * @module entry/callable/get_sharing_overview
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_sharing_overview = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const connections_orchestrator_1 = require("../../orchestrators/sharing/connections.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Everything the Groups screen shows: groups, connected people, requests, limits.
 */
exports.get_sharing_overview = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "get_sharing_overview");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
        (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
            user_id,
            error_code: "VALIDATION_ERROR",
        });
        return (0, types_1.error_response)("VALIDATION_ERROR", validation.error.issues.map((i) => i.message).join("; "), trace.trace_id);
    }
    try {
        const result = await (0, connections_orchestrator_1.get_sharing_overview_orchestrator)(Object.assign(Object.assign({}, trace), { input: {}, user_id, idempotency_key: `get_sharing_overview:${trace.trace_id}` }));
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to load your groups. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=get_sharing_overview.entry.js.map