"use strict";
/**
 * Sharing Resolvers (Account-Rooted-Sharing Phase 1)
 *
 * READ-ONLY. Each resolver loads exactly what one sharing operation's domain
 * rule needs. No decisions here: lookups only.
 *
 * @module resolvers/sharing/sharing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_my_code = resolve_my_code;
exports.resolve_code_taken = resolve_code_taken;
exports.resolve_code_entry = resolve_code_entry;
exports.resolve_overview = resolve_overview;
exports.resolve_connection_action = resolve_connection_action;
exports.resolve_invites = resolve_invites;
exports.resolve_request = resolve_request;
exports.resolve_group_pending_requests = resolve_group_pending_requests;
exports.to_placeable = to_placeable;
exports.resolve_share_account = resolve_share_account;
exports.resolve_account_placement = resolve_account_placement;
exports.resolve_share_accept = resolve_share_accept;
exports.resolve_group_accounts = resolve_group_accounts;
const sharing_1 = require("../../repositories/sharing");
const connection_service_1 = require("../../domain/sharing/connection.service");
const request_service_1 = require("../../domain/sharing/request.service");
const account_repo_1 = require("../../repositories/account.repo");
/** For get_my_connect_code. */
async function resolve_my_code(ctx, user_id) {
    const [existing, connection_count] = await Promise.all([
        sharing_1.connect_code_repo.get_by_user(ctx, user_id),
        sharing_1.connection_repo.count_connected(ctx, user_id),
    ]);
    return { existing, connection_count };
}
/** Whether a freshly generated code is already in use by someone else. */
async function resolve_code_taken(ctx, code, user_id, now_ms) {
    const matches = await sharing_1.connect_code_repo.find_active_by_code(ctx, code, now_ms);
    return matches.some((m) => m.user_id !== user_id);
}
/** For enter_connect_code. */
async function resolve_code_entry(ctx, user_id, code, now_ms) {
    const [caller_code, matches, caller_connection_count] = await Promise.all([
        sharing_1.connect_code_repo.get_by_user(ctx, user_id),
        sharing_1.connect_code_repo.find_active_by_code(ctx, code, now_ms),
        sharing_1.connection_repo.count_connected(ctx, user_id),
    ]);
    const target = matches.length === 1 ? matches[0] : null;
    if (!target || target.user_id === user_id) {
        return {
            caller_code,
            target,
            existing_connection: null,
            caller_connection_count,
            target_connection_count: 0,
        };
    }
    const [existing_connection, target_connection_count] = await Promise.all([
        sharing_1.connection_repo.get(ctx, (0, connection_service_1.pair_id)(user_id, target.user_id)),
        sharing_1.connection_repo.count_connected(ctx, target.user_id),
    ]);
    return {
        caller_code,
        target,
        existing_connection,
        caller_connection_count,
        target_connection_count,
    };
}
/** For get_sharing_overview. */
async function resolve_overview(ctx, user_id) {
    const [connections, groups, requests] = await Promise.all([
        sharing_1.connection_repo.get_for_user(ctx, user_id),
        sharing_1.group_repo.get_for_user(ctx, user_id),
        sharing_1.request_repo.get_pending_for_recipient(ctx, user_id),
    ]);
    const request_group_docs = await sharing_1.group_repo.get_many(ctx, requests.map((r) => r.group_id));
    const request_groups = {};
    for (const g of request_group_docs)
        request_groups[g.id] = g;
    return { connections, groups, requests, request_groups };
}
/** For manage_connection. */
async function resolve_connection_action(ctx, user_id, other_user_id) {
    const [connection, mine, theirs] = await Promise.all([
        sharing_1.connection_repo.get(ctx, (0, connection_service_1.pair_id)(user_id, other_user_id)),
        sharing_1.request_repo.get_pending_for_recipient(ctx, user_id),
        sharing_1.request_repo.get_pending_for_recipient(ctx, other_user_id),
    ]);
    const pending_between = [
        ...mine.filter((r) => r.from_user_id === other_user_id),
        ...theirs.filter((r) => r.from_user_id === user_id),
    ];
    return { connection, pending_between };
}
/** For create_group / add_to_group: the caller's links to each invitee. */
async function resolve_invites(ctx, user_id, group_id, invitee_ids, now_ms) {
    const unique = [...new Set(invitee_ids)];
    const [group, sent_today, ...conns] = await Promise.all([
        group_id ? sharing_1.group_repo.get(ctx, group_id) : Promise.resolve(null),
        sharing_1.request_repo.get_sent_since(ctx, user_id, now_ms - request_service_1.DAY_MS),
        ...unique.map((uid) => sharing_1.connection_repo.get(ctx, (0, connection_service_1.pair_id)(user_id, uid))),
    ]);
    const connections = {};
    unique.forEach((uid, i) => {
        connections[uid] = conns[i];
    });
    return { group: group, connections, sent_today: sent_today };
}
/** For respond_to_request. */
async function resolve_request(ctx, request_id) {
    const request = await sharing_1.request_repo.get(ctx, request_id);
    if (!request)
        return { request: null, inviter_connection: null };
    const inviter_connection = await sharing_1.connection_repo.get(ctx, (0, connection_service_1.pair_id)(request.from_user_id, request.to_user_id));
    return { request, inviter_connection };
}
/** For manage_group: pending requests to cancel when a group is deleted. */
async function resolve_group_pending_requests(ctx, group_id) {
    return sharing_1.request_repo.get_pending_for_group(ctx, group_id);
}
// ---------------------------------------------------------------------------
// Phase 2.1: account placement
// ---------------------------------------------------------------------------
/** Repo account → the fields placement rules need. */
function to_placeable(a) {
    var _a, _b;
    if (!a)
        return null;
    return {
        id: a.id,
        user_id: a.user_id,
        is_active: a.is_active,
        name: a.name,
        mask: (_a = a.mask) !== null && _a !== void 0 ? _a : null,
        institution_id: a.institution.id,
        account_subtype: a.account_subtype,
        placement: (_b = a.placement) !== null && _b !== void 0 ? _b : null,
    };
}
/** For share_account. */
async function resolve_share_account(ctx, user_id, account_id, group_id, now_ms) {
    const [account, group, shared, pending_for_account, sent_today] = await Promise.all([
        account_repo_1.account_repo.get_by_id(ctx, account_id),
        sharing_1.group_repo.get(ctx, group_id),
        account_repo_1.account_repo.get_shared_with_group(ctx, group_id),
        sharing_1.request_repo.get_pending_for_target(ctx, account_id),
        sharing_1.request_repo.get_sent_since(ctx, user_id, now_ms - request_service_1.DAY_MS),
    ]);
    return {
        account: to_placeable(account),
        group,
        group_accounts: shared.map((a) => to_placeable(a)),
        pending_for_account,
        sent_today,
    };
}
/** For unshare_account and accepting a share request. */
async function resolve_account_placement(ctx, account_id) {
    const [account, pending] = await Promise.all([
        account_repo_1.account_repo.get_by_id(ctx, account_id),
        sharing_1.request_repo.get_pending_for_target(ctx, account_id),
    ]);
    return { account: to_placeable(account), pending };
}
/** For accepting a share_account request: the account, its pending requests, the group. */
async function resolve_share_accept(ctx, request) {
    var _a;
    const [placement, group] = await Promise.all([
        resolve_account_placement(ctx, (_a = request.target_id) !== null && _a !== void 0 ? _a : ""),
        sharing_1.group_repo.get(ctx, request.group_id),
    ]);
    return Object.assign(Object.assign({}, placement), { group });
}
/** For manage_group leave / remove / delete: accounts shared with the group. */
async function resolve_group_accounts(ctx, group_id) {
    const shared = await account_repo_1.account_repo.get_shared_with_group(ctx, group_id);
    return shared.map((a) => to_placeable(a));
}
//# sourceMappingURL=sharing.resolver.js.map