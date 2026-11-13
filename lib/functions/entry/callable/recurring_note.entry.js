"use strict";
/**
 * Shared bill / income detail + notes (Account-Rooted-Sharing; Budget-And-Bill-Detail-Pages).
 *
 * - `get_recurring_detail`: Bill / Income detail's data for a period the app can't read itself
 *   (a member of the group the account is shared with). Timestamps come back as `{ __ts: ms }`.
 * - `set_recurring_note`: set or clear a bill / income period's note, or an income's
 *   every-month note — the owner or any member of the group its account is shared with.
 *
 * @module entry/callable/recurring_note
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
exports.set_recurring_note = exports.get_recurring_detail = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const recurring_note_orchestrator_1 = require("../../orchestrators/recurring/recurring_note.orchestrator");
const types_1 = require("../../types");
const kind = zod_1.z.enum(["outflow", "inflow"]);
const id = zod_1.z.string().min(1).max(256);
const detail_schema = zod_1.z.object({ kind, period_id: id });
const note_schema = zod_1.z.object({
    kind,
    recurring_id: id,
    period_id: id.optional(),
    scope: zod_1.z.enum(["period", "income"]),
    note: zod_1.z.string().max(4000),
});
const issues = (e) => e.issues.map((i) => i.message).join("; ");
const to_https = (error, fallback, trace_id) => {
    if (error instanceof https_1.HttpsError)
        return error;
    if (error instanceof types_1.DomainError) {
        return new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id });
    }
    console.error(fallback, error);
    return new https_1.HttpsError("internal", fallback, { trace_id });
};
exports.get_recurring_detail = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const parsed = detail_schema.safeParse(request.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", issues(parsed.error));
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        const result = await (0, recurring_note_orchestrator_1.get_recurring_detail_orchestrator)(ctx, request.auth.uid, parsed.data);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        throw to_https(error, "Could not load this item", ctx.trace_id);
    }
});
exports.set_recurring_note = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const parsed = note_schema.safeParse(request.data);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", issues(parsed.error));
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        const _a = parsed.data, { period_id } = _a, rest = __rest(_a, ["period_id"]);
        const result = await (0, recurring_note_orchestrator_1.set_recurring_note_orchestrator)(ctx, request.auth.uid, Object.assign(Object.assign({}, rest), { period_id: period_id !== null && period_id !== void 0 ? period_id : null }));
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        throw to_https(error, "Could not save the note", ctx.trace_id);
    }
});
//# sourceMappingURL=recurring_note.entry.js.map