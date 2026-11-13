"use strict";
/**
 * Who may open, and note, a bill (outflow) or income (inflow) — Account-Rooted-Sharing.
 *
 * A recurring item follows its account: the owner always may; anyone else only when the item's
 * account is shared with a group the caller is a member of AND the owner is still a member (the
 * same rule the group period view uses, `resolve_derive_scope`). The group doc is the membership
 * truth. READ-ONLY.
 *
 * @module resolvers/recurring/recurring_access
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_access = resolve_recurring_access;
exports.resolve_recurring_detail_deps = resolve_recurring_detail_deps;
exports.resolve_recurring_note_deps = resolve_recurring_note_deps;
const types_1 = require("../../types");
const repositories_1 = require("../../repositories");
const sharing_1 = require("../../repositories/sharing");
const group_service_1 = require("../../domain/sharing/group.service");
const recurring_note_repo_1 = require("../../repositories/recurring_note.repo");
const recurring_note_service_1 = require("../../domain/recurring/recurring_note.service");
async function resolve_recurring_access(ctx, caller_id, kind, recurring_id) {
    var _a, _b;
    const item = kind === "outflow"
        ? await repositories_1.outflow_repo.get_by_id(ctx, recurring_id)
        : await repositories_1.inflow_repo.get_by_id(ctx, recurring_id);
    if (!item)
        throw new types_1.NotFoundError(kind === "outflow" ? "Bill" : "Income", recurring_id);
    if (item.user_id === caller_id)
        return { owner_id: item.user_id, via_group_id: null };
    // Not the owner: the item's account must be placed in a group both are members of.
    const accounts = await repositories_1.account_repo.get_by_user_id(ctx, item.user_id);
    const account = accounts.find((a) => a.account_id === item.account_id || a.id === item.account_id);
    const group_id = (_b = (_a = account === null || account === void 0 ? void 0 : account.placement) === null || _a === void 0 ? void 0 : _a.group_id) !== null && _b !== void 0 ? _b : null;
    if (!group_id)
        throw new types_1.PermissionDeniedError("open", `${kind} ${recurring_id}`);
    const group = await sharing_1.group_repo.get(ctx, group_id);
    if (!(0, group_service_1.is_member)(group, caller_id) || !(0, group_service_1.is_member)(group, item.user_id)) {
        throw new types_1.PermissionDeniedError("open", `${kind} ${recurring_id}`);
    }
    return { owner_id: item.user_id, via_group_id: group_id };
}
async function resolve_recurring_detail_deps(ctx, caller_id, kind, period_id) {
    const period = await recurring_note_repo_1.recurring_note_repo.get_period_raw(ctx, kind, period_id);
    const recurring_id = period ? (0, recurring_note_service_1.period_recurring_id)(kind, period) : null;
    if (!period || !recurring_id) {
        throw new types_1.NotFoundError(kind === "outflow" ? "Bill period" : "Income period", period_id);
    }
    const access = await resolve_recurring_access(ctx, caller_id, kind, recurring_id);
    const definition = await recurring_note_repo_1.recurring_note_repo.get_definition_raw(ctx, kind, recurring_id);
    if (!definition)
        throw new types_1.NotFoundError(kind === "outflow" ? "Bill" : "Income", recurring_id);
    return { period, recurring_id, definition, access };
}
/** What `set_recurring_note` needs: access, plus the period when the note is on one. */
async function resolve_recurring_note_deps(ctx, caller_id, kind, recurring_id, period_id) {
    const access = await resolve_recurring_access(ctx, caller_id, kind, recurring_id);
    const period = period_id ? await recurring_note_repo_1.recurring_note_repo.get_period_raw(ctx, kind, period_id) : null;
    if (period_id && !period) {
        throw new types_1.NotFoundError(kind === "outflow" ? "Bill period" : "Income period", period_id);
    }
    return { access, period };
}
//# sourceMappingURL=recurring_access.resolver.js.map