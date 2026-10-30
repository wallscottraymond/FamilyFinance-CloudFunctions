"use strict";
/**
 * Derive Scope Resolver (Account-Rooted-Sharing D2; Rules §4.1–4.2)
 *
 * READ-ONLY. Turns a scope request into a resolved scope, server-side. Never
 * trusts a client-sent account list: the account set comes from placements.
 *   - Me: the caller's ACTIVE accounts that are shared are excluded (an inactive
 *     shared account counts nowhere in a group, so its kept history stays in Me).
 *   - Group: the caller must be a member (else PermissionDeniedError); the view
 *     is the group's active shared accounts whose owner is still a member.
 *
 * @module resolvers/periods/derive_scope
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.load_pairing_extra_txns = load_pairing_extra_txns;
exports.resolve_derive_scope = resolve_derive_scope;
const types_1 = require("../../types");
const account_repo_1 = require("../../repositories/account.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const user_repo_1 = require("../../repositories/user.repo");
const sharing_1 = require("../../repositories/sharing");
const group_service_1 = require("../../domain/sharing/group.service");
const derive_scope_service_1 = require("../../domain/periods/derive_scope.service");
/**
 * Pairing-only transactions (D12): for Me, the user's groups' shared accounts owned by other
 * members, so a transfer into a group account is recognized as one. Never counted. Empty when
 * the scope has nothing extra (always, for a user in no groups).
 */
async function load_pairing_extra_txns(ctx, scope, start_ms, end_ms) {
    const extra = scope.pairing_extra;
    if (!extra)
        return [];
    const lists = await Promise.all(extra.member_ids.map((m) => transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, m, start_ms, end_ms)));
    return lists
        .flat()
        .filter((t) => { var _a; return extra.account_ids.has((_a = t.data.accountId) !== null && _a !== void 0 ? _a : ""); });
}
async function resolve_derive_scope(ctx, caller_id, request) {
    var _a;
    if (!request || request.kind === "me") {
        // Someone in no groups can't have shared accounts: skip the accounts read.
        const user = await user_repo_1.user_repo.get_by_id(ctx, caller_id);
        const group_ids = (_a = user === null || user === void 0 ? void 0 : user.data.groupIds) !== null && _a !== void 0 ? _a : [];
        if (group_ids.length === 0)
            return (0, derive_scope_service_1.build_me_scope)(caller_id, []);
        // The GROUP docs are the membership truth (users.groupIds is a mirror): an account leaves
        // Me only for a group the user is actually a member of — exactly the groups whose view
        // counts it (that view also requires its owner to be a member). Any stale placement
        // counts back in Me, so money can't fall between the two.
        const [accounts, groups] = await Promise.all([
            account_repo_1.account_repo.get_by_user_id(ctx, caller_id),
            sharing_1.group_repo.get_many(ctx, group_ids),
        ]);
        const my_groups = groups.filter((g) => (0, group_service_1.is_member)(g, caller_id));
        const member_of = new Set(my_groups.map((g) => g.id));
        // Accounts of the user's groups (for transfer pairing only, D12): each group's shared
        // accounts whose owner is a member.
        const groups_accounts = (await Promise.all(my_groups.map((g) => account_repo_1.account_repo.get_shared_with_group(ctx, g.id))))
            .flatMap((list, i) => list.filter((a) => my_groups[i].member_ids.includes(a.user_id)))
            .map((a) => {
            var _a, _b;
            return ({
                doc_id: a.id,
                plaid_account_id: a.account_id || null,
                owner_id: a.user_id,
                shared_from_ms: (_b = (_a = a.placement) === null || _a === void 0 ? void 0 : _a.shared_from_ms) !== null && _b !== void 0 ? _b : null,
            });
        });
        return (0, derive_scope_service_1.build_me_scope)(caller_id, accounts
            .filter((a) => !!a.placement && member_of.has(a.placement.group_id))
            .map((a) => {
            var _a, _b;
            return ({
                doc_id: a.id,
                plaid_account_id: a.account_id || null,
                shared_from_ms: (_b = (_a = a.placement) === null || _a === void 0 ? void 0 : _a.shared_from_ms) !== null && _b !== void 0 ? _b : null,
            });
        }), groups_accounts);
    }
    const group = await sharing_1.group_repo.get(ctx, request.group_id);
    if (!(0, group_service_1.is_member)(group, caller_id)) {
        throw new types_1.PermissionDeniedError("view", `group ${request.group_id}`);
    }
    const shared = await account_repo_1.account_repo.get_shared_with_group(ctx, request.group_id);
    return (0, derive_scope_service_1.build_group_scope)(request.group_id, group.member_ids, shared.map((a) => {
        var _a, _b;
        return ({
            doc_id: a.id,
            plaid_account_id: a.account_id || null,
            owner_id: a.user_id,
            shared_from_ms: (_b = (_a = a.placement) === null || _a === void 0 ? void 0 : _a.shared_from_ms) !== null && _b !== void 0 ? _b : null,
        });
    }));
}
//# sourceMappingURL=derive_scope.resolver.js.map