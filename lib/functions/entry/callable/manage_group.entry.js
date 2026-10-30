"use strict";
/**
 * Manage Group Entry Point (Account-Rooted-Sharing)
 *
 * Rename, remove a member, hand over ownership, leave or delete a group.
 *
 * @module entry/callable/manage_group
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manage_group = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const groups_orchestrator_1 = require("../../orchestrators/sharing/groups.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.discriminatedUnion("action", [
    zod_1.z.object({
        action: zod_1.z.literal("rename"),
        group_id: zod_1.z.string().trim().min(1).max(128),
        name: zod_1.z.string().max(200),
    }),
    zod_1.z.object({
        action: zod_1.z.literal("remove_member"),
        group_id: zod_1.z.string().trim().min(1).max(128),
        user_id: zod_1.z.string().trim().min(1).max(128),
    }),
    zod_1.z.object({
        action: zod_1.z.literal("transfer_ownership"),
        group_id: zod_1.z.string().trim().min(1).max(128),
        user_id: zod_1.z.string().trim().min(1).max(128),
    }),
    zod_1.z.object({ action: zod_1.z.literal("leave"), group_id: zod_1.z.string().trim().min(1).max(128) }),
    zod_1.z.object({ action: zod_1.z.literal("delete"), group_id: zod_1.z.string().trim().min(1).max(128) }),
]);
/**
 * Rename, remove a member, hand over ownership, leave or delete a group.
 */
exports.manage_group = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "manage_group");
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
        const result = await (0, groups_orchestrator_1.manage_group_orchestrator)(Object.assign(Object.assign({}, trace), { input: validation.data, user_id, idempotency_key: `manage_group:${trace.trace_id}` }));
        if (!result.success) {
            return (0, types_1.error_response)("VALIDATION_ERROR", ((_b = result.errors) !== null && _b !== void 0 ? _b : ["Not allowed"]).join("; "), trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to update the group. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=manage_group.entry.js.map