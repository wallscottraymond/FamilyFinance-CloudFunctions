"use strict";
/**
 * Share Account Entry Point (Account-Rooted-Sharing)
 *
 * The account owner shares an account with a group (members accept; a group of
 * one applies at once).
 *
 * @module entry/callable/share_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.share_account = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const placement_orchestrator_1 = require("../../orchestrators/sharing/placement.orchestrator");
const types_1 = require("../../types");
/** The local date → its UTC-midnight ms (how transaction dates are stored); only a date within
 *  ±2 days of now is accepted (else the server's own day is used). */
function share_from_ms(date) {
    if (!date)
        return null;
    const [y, m, d] = date.split("-").map(Number);
    const ms = Date.UTC(y, m - 1, d);
    return Math.abs(ms - Date.now()) <= 2 * 86400000 ? ms : null;
}
const schema = zod_1.z.object({
    account_id: zod_1.z.string().trim().min(1).max(128),
    group_id: zod_1.z.string().trim().min(1).max(128),
    include_history: zod_1.z.boolean().default(false),
    /** "From today on": the user's LOCAL date (YYYY-MM-DD) — share from the start of that day. */
    share_from_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * The account owner shares an account with a group (members accept; a group of
 * one applies at once).
 */
exports.share_account = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "share_account");
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
        const result = await (0, placement_orchestrator_1.share_account_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                account_id: validation.data.account_id,
                group_id: validation.data.group_id,
                include_history: validation.data.include_history,
                share_from_ms: share_from_ms(validation.data.share_from_date),
            }, user_id, idempotency_key: `share_account:${trace.trace_id}` }));
        if (!result.success) {
            return (0, types_1.error_response)("VALIDATION_ERROR", ((_b = result.errors) !== null && _b !== void 0 ? _b : ["Not allowed"]).join("; "), trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to share the account. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=share_account.entry.js.map