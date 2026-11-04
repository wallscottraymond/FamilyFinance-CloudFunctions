"use strict";
/**
 * The checklist's callables (Manual-Budgets, AF-02). `get_budget_checklist` reads it;
 * `edit_budget_checklist` applies one edit, so two people's changes both survive. Any member may edit
 * a group budget's, like every budget edit. A budget the caller can't manage reads as not found.
 *
 * @module entry/callable/set_budget_checklist
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.edit_budget_checklist = exports.get_budget_checklist = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const budget_checklist_repo_1 = require("../../repositories/budget_checklist.repo");
const set_budget_pause_resolver_1 = require("../../resolvers/budgets/set_budget_pause.resolver");
const types_1 = require("../../types");
const budget_id = zod_1.z.string().min(1).max(128);
const id = zod_1.z.string().min(1).max(64);
const period_key = zod_1.z.string().min(1).max(32);
const edit_schema = zod_1.z.object({
    budget_id,
    edit: zod_1.z.discriminatedUnion("op", [
        zod_1.z.object({ op: zod_1.z.literal("add"), id, name: zod_1.z.string().max(100), estimate: zod_1.z.number().min(0).max(100000000), period_key }),
        zod_1.z.object({ op: zod_1.z.literal("remove"), id }),
        zod_1.z.object({ op: zod_1.z.literal("tick"), id, period_key, ticked: zod_1.z.boolean() }),
        zod_1.z.object({ op: zod_1.z.literal("carry"), carry: zod_1.z.boolean(), period_key }),
    ]),
});
const to_https = (error, fallback) => {
    if (error instanceof https_1.HttpsError)
        return error;
    if (error instanceof types_1.DomainError)
        return new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code));
    console.error(fallback, error);
    return new https_1.HttpsError("internal", fallback);
};
exports.get_budget_checklist = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const parsed = budget_id.safeParse((_a = request.data) === null || _a === void 0 ? void 0 : _a.budget_id);
    if (!parsed.success)
        throw new https_1.HttpsError("invalid-argument", "budget_id is invalid");
    try {
        await (0, set_budget_pause_resolver_1.resolve_set_budget_pause_dependencies)((0, observability_1.create_trace_context)(false), request.auth.uid, parsed.data);
        return { checklist: await budget_checklist_repo_1.budget_checklist_repo.get(parsed.data) };
    }
    catch (error) {
        throw to_https(error, "Could not load the checklist");
    }
});
exports.edit_budget_checklist = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const parsed = edit_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    try {
        const { existing } = await (0, set_budget_pause_resolver_1.resolve_set_budget_pause_dependencies)((0, observability_1.create_trace_context)(false), request.auth.uid, parsed.data.budget_id);
        const { checklist, errors } = await budget_checklist_repo_1.budget_checklist_repo.apply(parsed.data.budget_id, existing.user_id, parsed.data.edit);
        if (!checklist)
            throw new https_1.HttpsError("invalid-argument", (errors !== null && errors !== void 0 ? errors : []).join("; "));
        return { checklist };
    }
    catch (error) {
        throw to_https(error, "Could not save the checklist");
    }
});
//# sourceMappingURL=set_budget_checklist.entry.js.map