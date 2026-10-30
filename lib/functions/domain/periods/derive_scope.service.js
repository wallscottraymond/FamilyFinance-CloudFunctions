"use strict";
/**
 * Derive Scope (Account-Rooted-Sharing D2, D5, P1, N9; Rules §4.2–4.3, §5.1)
 *
 * Which money a derived view counts:
 *   - Me: everything the user owns EXCEPT accounts they've shared with a group
 *     (each account lives in exactly one view). A transaction / bill / goal with
 *     no account, or an account we don't know, stays in Me — so a user who shares
 *     nothing gets EXACTLY today's numbers.
 *   - Group: only accounts shared with that group whose owner is still a member
 *     (a failed release on leave can never keep someone's money visible), and
 *     only their transactions on/after each account's share-from date.
 *
 * Accounts are matched by EITHER their document id or their Plaid account id
 * (transactions / bills store the Plaid id; goals store the document id).
 *
 * PURE: no IO.
 *
 * @module domain/periods/derive_scope
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_me_scope = build_me_scope;
exports.build_group_scope = build_group_scope;
exports.account_in_scope = account_in_scope;
exports.transaction_in_scope = transaction_in_scope;
exports.group_view_version = group_view_version;
exports.me_view_version = me_view_version;
exports.widget_view_version = widget_view_version;
const crypto_1 = require("crypto");
/** Me scope: exclude the user's own shared accounts. */
function build_me_scope(user_id, my_shared_accounts, my_groups_accounts = []) {
    var _a;
    const exclude = new Set();
    const shared_from = new Map();
    for (const a of my_shared_accounts) {
        for (const id of [a.doc_id, a.plaid_account_id]) {
            if (!id)
                continue;
            exclude.add(id);
            shared_from.set(id, (_a = a.shared_from_ms) !== null && _a !== void 0 ? _a : null);
        }
    }
    // Accounts of the user's groups owned by OTHER members: known to the user, so a transfer
    // between one of them and the user's own account is a transfer, not outside money (D12).
    const extra_members = new Set();
    const extra_accounts = new Set();
    for (const a of my_groups_accounts) {
        if (a.owner_id === user_id)
            continue;
        extra_members.add(a.owner_id);
        if (a.plaid_account_id)
            extra_accounts.add(a.plaid_account_id);
        extra_accounts.add(a.doc_id);
    }
    return {
        kind: "me",
        budget_owner_key: user_id,
        member_ids: [user_id],
        include_account_ids: null,
        exclude_account_ids: exclude,
        shared_from,
        group_id: null,
        pairing_extra: extra_members.size
            ? { member_ids: [...extra_members], account_ids: extra_accounts }
            : null,
    };
}
/** Group scope: only accounts shared with it whose owner is a current member. */
function build_group_scope(group_id, member_ids, shared_accounts) {
    const members = new Set(member_ids);
    const include = new Set();
    const shared_from = new Map();
    for (const a of shared_accounts) {
        if (!members.has(a.owner_id))
            continue; // owner left: never counts here
        for (const id of [a.doc_id, a.plaid_account_id]) {
            if (!id)
                continue;
            include.add(id);
            shared_from.set(id, a.shared_from_ms);
        }
    }
    return {
        kind: "group",
        budget_owner_key: `group:${group_id}`,
        member_ids: [...members],
        include_account_ids: include,
        exclude_account_ids: new Set(),
        shared_from,
        group_id,
        pairing_extra: null,
    };
}
/** Does an item tied to `account_id` (bill, income stream, goal) belong to this view? */
function account_in_scope(scope, account_id) {
    if (scope.include_account_ids) {
        return !!account_id && scope.include_account_ids.has(account_id);
    }
    return !account_id || !scope.exclude_account_ids.has(account_id);
}
/** Does a transaction count in this view (account + share-from date)? */
function transaction_in_scope(scope, account_id, date_ms) {
    const from = account_id ? scope.shared_from.get(account_id) : undefined;
    if (!scope.include_account_ids) {
        // Me: a shared account's transactions from BEFORE its share-from date stay private (N9).
        if (account_id && scope.exclude_account_ids.has(account_id)) {
            return from !== null && from !== undefined && date_ms < from;
        }
        return true;
    }
    if (!account_in_scope(scope, account_id))
        return false;
    return from === null || from === undefined || date_ms >= from;
}
/**
 * A group view's cache version: a fingerprint of everything that can change its numbers —
 * who's in it, the group's own version (its budgets), and every member's version (their
 * transactions / bills / placements). Any member edit or membership change → new version.
 * Deterministic; a safe integer (52 bits of a SHA-1). PURE.
 */
function group_view_version(member_ids, group_version, member_versions) {
    const members = [...member_ids].sort();
    const parts = [
        `g=${group_version}`,
        ...members.map((m) => { var _a; return `${m}=${(_a = member_versions[m]) !== null && _a !== void 0 ? _a : 0}`; }),
    ];
    const hex = (0, crypto_1.createHash)("sha1").update(parts.join("|")).digest("hex").slice(0, 13);
    return parseInt(hex, 16);
}
/**
 * A Me view's cache version. With no groups it is the user's own version, unchanged. In a
 * group, Me also pairs transfers against other members' transactions on the group's shared
 * accounts (D12), so it fingerprints the user's own version, each group + its members, and
 * every other member's version: a partner's sync, share/unshare, or any join/leave moves it.
 * Deterministic; a safe integer. PURE.
 */
function me_view_version(own_version, groups, member_versions) {
    if (groups.length === 0)
        return own_version;
    const parts = [
        `me=${own_version}`,
        ...[...groups]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((g) => `${g.id}:${[...g.member_ids].sort().join(",")}`),
        ...Object.keys(member_versions)
            .sort()
            .map((m) => `${m}=${member_versions[m]}`),
    ];
    const hex = (0, crypto_1.createHash)("sha1").update(parts.join("|")).digest("hex").slice(0, 13);
    return parseInt(hex, 16);
}
/**
 * A widget's "unchanged" version: the view version plus the UTC day. The widget payload
 * carries day-relative fields (current period, `overdue` vs today's UTC start), so a widget
 * must refetch once per UTC day even when no data changed. Deterministic; a safe integer. PURE.
 */
function widget_view_version(view_version, now_ms) {
    const day = Math.floor(now_ms / (24 * 60 * 60 * 1000));
    const hex = (0, crypto_1.createHash)("sha1").update(`v=${view_version}|d=${day}`).digest("hex").slice(0, 13);
    return parseInt(hex, 16);
}
//# sourceMappingURL=derive_scope.service.js.map