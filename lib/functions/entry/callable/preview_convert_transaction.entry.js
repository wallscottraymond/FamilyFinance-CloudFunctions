"use strict";
/**
 * Preview Convert Transaction Entry Point (Convert-To-Recurring Phase 2): read-only suggestions for
 * the "Make this a bill" sheet (name, amount, schedule guess, how many past payments would link).
 * Owner only; flag-gated (`{enabled: false}` when off).
 *
 * @module entry/callable/preview_convert_transaction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.preview_convert_transaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const preview_convert_transaction_orchestrator_1 = require("../../orchestrators/recurring/preview_convert_transaction.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    transaction_id: zod_1.z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "transaction_id is invalid"),
    split_id: zod_1.z.string().min(1).max(128).regex(/^[^/]+$/, "split_id is invalid").optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.preview_convert_transaction = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "preview_convert_transaction");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const result = await (0, preview_convert_transaction_orchestrator_1.preview_convert_transaction_orchestrator)(ctx, user_id, { transaction_id: validation.data.transaction_id, split_id: validation.data.split_id }, Date.now());
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error instanceof types_1.ConvertRefusedError) {
            throw new https_1.HttpsError("failed-precondition", error.message, { trace_id: ctx.trace_id, code: error.code });
        }
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id });
        }
        throw new https_1.HttpsError("internal", "Failed to preview", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=preview_convert_transaction.entry.js.map