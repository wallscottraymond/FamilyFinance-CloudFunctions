"use strict";
/**
 * Convert Transaction To Recurring Entry Point (Convert-To-Recurring Phase 2)
 *
 * "Make this a bill / income" from a transaction (or one split). Owner only (D24); flag-gated.
 * Returns the new record's id; a refusal comes back as `failed-precondition` with a `code` the sheet
 * shows (ALREADY_TRACKED carries the bill's id + name).
 *
 * @module entry/callable/convert_transaction_to_recurring
 */
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convert_transaction_to_recurring = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const convert_transaction_to_recurring_orchestrator_1 = require("../../orchestrators/recurring/convert_transaction_to_recurring.orchestrator");
const convert_recurring_service_1 = require("../../domain/recurring/convert_recurring.service");
const types_1 = require("../../types");
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const schema = zod_1.z.object({
    transaction_id: zod_1.z.string().regex(ID, "transaction_id is invalid"),
    split_id: zod_1.z.string().min(1).max(128).regex(/^[^/]+$/, "split_id is invalid").optional(),
    name: zod_1.z.string().trim().min(1, "A name is required").max(convert_recurring_service_1.CONVERT_NAME_MAX),
    amount: zod_1.z.number().positive("The amount must be greater than zero").max(convert_recurring_service_1.CONVERT_AMOUNT_MAX),
    frequency: zod_1.z.enum(convert_recurring_service_1.CONVERT_FREQUENCIES),
    next_due_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date"),
    link_past: zod_1.z.boolean().default(true),
    review_item_id: zod_1.z.string().regex(ID, "review_item_id is invalid").optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.convert_transaction_to_recurring = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "convert_transaction_to_recurring");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const _c = validation.data, { debug_mode: _debug } = _c, input = __rest(_c, ["debug_mode"]);
        void _debug;
        const result = await (0, convert_transaction_to_recurring_orchestrator_1.convert_transaction_to_recurring_orchestrator)(ctx, user_id, input, Date.now());
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error instanceof types_1.ConvertRefusedError) {
            throw new https_1.HttpsError("failed-precondition", error.message, Object.assign({ trace_id: ctx.trace_id, code: error.code }, ((_b = error.details) !== null && _b !== void 0 ? _b : {})));
        }
        if (error instanceof types_1.DomainError) {
            const message = error.code === "VALIDATION_ERROR" ? error.message : (0, types_1.get_user_message)(error.code);
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), message, { trace_id: ctx.trace_id, code: error.code });
        }
        throw new https_1.HttpsError("internal", "Failed to make this a bill", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=convert_transaction_to_recurring.entry.js.map