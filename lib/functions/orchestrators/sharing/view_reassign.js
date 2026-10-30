"use strict";
/**
 * View-change re-assign (Transaction-Integrity-Review H6): when an account changes view (shared,
 * accepted, unshared, released by a departure) or a view's budgets change (a budget moved
 * between Me and a group), the affected transactions are re-assigned against the budgets of the
 * view they now count in — through the ONE bounded re-assign engine (reassign_user), one run per
 * account owner, scoped to just the accounts that moved. Never throws (a failed enqueue is
 * logged; the next edit / sync re-assigns those transactions anyway).
 *
 * @module orchestrators/sharing/view_reassign
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REHOME_BACK_MS = void 0;
exports.refresh_group_transfer_roles = refresh_group_transfer_roles;
exports.reassign_accounts = reassign_accounts;
exports.reassign_view = reassign_view;
const reassign_user_orchestrator_1 = require("../transactions/reassign_user.orchestrator");
const sharing_resolver_1 = require("../../resolvers/sharing/sharing.resolver");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
const account_repo_1 = require("../../repositories/account.repo");
const group_repo_1 = require("../../repositories/sharing/group.repo");
const job_queue_1 = require("../../infrastructure/job_queue");
const classify_internal_transfers_orchestrator_1 = require("../plaid/classify_internal_transfers.orchestrator");
/** A budget counts from the start of the period its start falls in (budget-start period snap), so
 *  a re-home reaches back one period before the earliest start. */
exports.REHOME_BACK_MS = 31 * 24 * 60 * 60 * 1000;
/**
 * A view change (share / accept / unshare / leave / remove / delete) changes which transfers cross
 * the group's boundary for EVERY member — not only the account's owner: a transfer between two
 * members' accounts can turn from "own accounts" into "leaving the view" (or back). Re-decide every
 * member's transfer roles (coalesced, one per member per burst), plus anyone who just left.
 */
async function refresh_group_transfer_roles(ctx, group_id, extra_user_ids = []) {
    var _a;
    const group = group_id ? await group_repo_1.group_repo.get(ctx, group_id).catch(() => null) : null;
    const members = new Set([...((_a = group === null || group === void 0 ? void 0 : group.member_ids) !== null && _a !== void 0 ? _a : []), ...extra_user_ids]);
    for (const user_id of members) {
        await (0, job_queue_1.coalesce_job)(classify_internal_transfers_orchestrator_1.CLASSIFY_TRANSFERS_JOB, { deduplication_key: `classify:${user_id}`, user_id }, { delay_seconds: 0, trace_id: ctx.trace_id }).catch(() => { });
    }
}
/** Re-assign these accounts' transactions (grouped per owner, scoped to the accounts). */
async function reassign_accounts(ctx, accounts, from_ms, reason = "view_change") {
    // A transaction's `accountId` may be the account doc id or its Plaid account id — scope both.
    const docs = await Promise.all(accounts.map((a) => account_repo_1.account_repo.get_by_id(ctx, a.id).catch(() => null)));
    const by_owner = new Map();
    accounts.forEach((a, i) => {
        var _a, _b;
        if (!a.user_id)
            return;
        const ids = [a.id, (_a = docs[i]) === null || _a === void 0 ? void 0 : _a.account_id].filter((x) => !!x);
        by_owner.set(a.user_id, [...((_b = by_owner.get(a.user_id)) !== null && _b !== void 0 ? _b : []), ...ids]);
    });
    for (const [user_id, account_ids] of by_owner) {
        // The accounts' view changed, so which transfers pair INSIDE a view (and which cross it)
        // changed too: re-decide the owner's transfer roles (coalesced) before / alongside.
        await (0, job_queue_1.coalesce_job)(classify_internal_transfers_orchestrator_1.CLASSIFY_TRANSFERS_JOB, { deduplication_key: `classify:${user_id}`, user_id }, { delay_seconds: 0, trace_id: ctx.trace_id }).catch(() => { });
        try {
            await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({ user_id, reason, scope: Object.assign({ account_ids }, (from_ms !== undefined ? { from_ms } : {})) }, ctx.trace_id);
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] view re-assign enqueue failed for ${user_id}:`, error);
        }
    }
}
/**
 * Re-assign every transaction that counts in a view whose budgets changed: Me = the user's own
 * transactions (unscoped — shared accounts resolve to their group and are left unchanged); a
 * group = each member's accounts shared with it.
 */
async function reassign_view(ctx, owner_key, from_ms) {
    const gid = (0, budget_view_service_1.group_id_of_key)(owner_key);
    if (!gid) {
        try {
            await (0, reassign_user_orchestrator_1.enqueue_reassign_user)(Object.assign({ user_id: owner_key, reason: "budget_categories" }, (from_ms !== undefined ? { scope: { from_ms } } : {})), ctx.trace_id);
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] view re-assign enqueue failed for ${owner_key}:`, error);
        }
        return;
    }
    const accounts = await (0, sharing_resolver_1.resolve_group_accounts)(ctx, gid).catch(() => []);
    await reassign_accounts(ctx, accounts.map((a) => ({ id: a.id, user_id: a.user_id })), from_ms, "budget_categories");
}
//# sourceMappingURL=view_reassign.js.map