"use strict";
/**
 * Get My Connect Code Entry Point (Account-Rooted-Sharing)
 *
 * Shows the caller's connect code (issues a new one when asked or when it has expired).
 *
 * @module entry/callable/get_my_connect_code
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_my_connect_code = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const connect_orchestrator_1 = require("../../orchestrators/sharing/connect.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    refresh: zod_1.z.boolean().default(false),
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Shows the caller's connect code (issues a new one when asked or when it has expired).
 */
exports.get_my_connect_code = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "get_my_connect_code");
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
        const result = await (0, connect_orchestrator_1.get_my_connect_code_orchestrator)(Object.assign(Object.assign({}, trace), { input: { refresh: validation.data.refresh }, user_id, idempotency_key: `get_my_connect_code:${trace.trace_id}` }));
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to get your code. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=get_my_connect_code.entry.js.map