"use strict";
/**
 * Undo Recurring Merge Entry Point (Convert-To-Recurring Phase 2): undo a same-bill merge (the old
 * bill is restored) or an absorbed Plaid stream (the next sync makes it a separate bill). Owner
 * only; flag-gated.
 *
 * @module entry/callable/undo_recurring_merge
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
exports.undo_recurring_merge = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const undo_recurring_merge_orchestrator_1 = require("../../orchestrators/recurring/undo_recurring_merge.orchestrator");
const types_1 = require("../../types");
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const schema = zod_1.z.discriminatedUnion("mode", [
    zod_1.z.object({ mode: zod_1.z.literal("merge"), kind: zod_1.z.enum(["outflow", "inflow"]), record_id: zod_1.z.string().regex(ID), debug_mode: zod_1.z.boolean().optional() }),
    zod_1.z.object({ mode: zod_1.z.literal("absorb"), kind: zod_1.z.enum(["outflow", "inflow"]), record_id: zod_1.z.string().regex(ID), stream_id: zod_1.z.string().regex(ID), debug_mode: zod_1.z.boolean().optional() }),
]);
exports.undo_recurring_merge = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "undo_recurring_merge");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const v = schema.safeParse(request.data);
        if (!v.success) {
            throw new https_1.HttpsError("invalid-argument", v.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const _b = v.data, { debug_mode: _d } = _b, input = __rest(_b, ["debug_mode"]);
        void _d;
        const result = await (0, undo_recurring_merge_orchestrator_1.undo_recurring_merge_orchestrator)(ctx, user_id, input, Date.now());
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
        throw new https_1.HttpsError("internal", "Failed to undo", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=undo_recurring_merge.entry.js.map