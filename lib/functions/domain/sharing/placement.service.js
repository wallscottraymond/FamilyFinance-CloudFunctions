"use strict";
/**
 * Account Placement (P1, D7, N9, I4, D25)
 *
 * An account is private (its owner's Me view) or shared with exactly one group.
 * Only the account's owner shares or unshares it. Sharing into a group with
 * other members sends each of them a request; the first Accept applies it
 * (PD5). In a group of one it applies at once. Unsharing needs no Accept.
 *
 * PURE: ids and time are passed in.
 *
 * @module domain/sharing/placement
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.account_fingerprint = account_fingerprint;
exports.account_label = account_label;
exports.plan_share_account = plan_share_account;
exports.placement_on_accept = placement_on_accept;
exports.recheck_immediate_placement = recheck_immediate_placement;
exports.placement_on_restore = placement_on_restore;
exports.plan_unshare_account = plan_unshare_account;
exports.placements_released = placements_released;
exports.requests_released = requests_released;
const types_1 = require("../../types");
const request_service_1 = require("./request.service");
const group_service_1 = require("./group.service");
/** Same bank + last 4 + subtype = the same real account linked twice (I4). */
function account_fingerprint(a) {
    if (!a.mask || !a.institution_id)
        return null;
    return `${a.institution_id}|${a.mask}|${a.account_subtype}`;
}
/** "Joint Checking ••1234" */
function account_label(a) {
    return a.mask ? `${a.name} ••${a.mask}` : a.name;
}
const ALREADY_SHARED = "Someone in this group already shares this account";
/** Another account in `others` that is the same real account (I4), if any. */
function find_duplicate(account, others) {
    const fp = account_fingerprint(account);
    if (!fp)
        return undefined;
    return others.find((g) => g.id !== account.id && account_fingerprint(g) === fp);
}
/** Decides what sharing an account with a group does. */
function plan_share_account(input) {
    var _a, _b;
    const { account, caller_id, group, now_ms } = input;
    if (!account || !account.is_active || account.user_id !== caller_id) {
        return (0, types_1.validation_failed)(["Only the account's owner can share it"]);
    }
    if (!(0, group_service_1.is_member)(group, caller_id))
        return (0, types_1.validation_failed)(["You're not in this group"]);
    if (account.placement) {
        return (0, types_1.validation_failed)([
            account.placement.group_id === group.id
                ? "This account is already shared with this group"
                : "This account is shared with another group. Make it private first.",
        ]);
    }
    const dup = find_duplicate(account, input.group_accounts);
    if (dup) {
        return {
            entity: { placement: null, requests: [], duplicate_owner_id: dup.user_id },
            validation_errors: [ALREADY_SHARED],
        };
    }
    const waiting = find_duplicate(account, (_a = input.pending_group_accounts) !== null && _a !== void 0 ? _a : []);
    if (waiting) {
        return {
            entity: { placement: null, requests: [], duplicate_owner_id: waiting.user_id },
            validation_errors: [
                "Someone in this group is already sharing this account (it's waiting for an Accept)",
            ],
        };
    }
    if (input.pending_for_account.some((r) => (0, request_service_1.is_open)(r, now_ms))) {
        return (0, types_1.validation_failed)(["This account is already waiting for someone to accept"]);
    }
    // From the START of the day (transactions are dated by day): a purchase made earlier today
    // counts in the group too. The app sends the user's local date; an older app gets the start of
    // the UTC day 12 hours ago (the right day across the Americas / Europe, never later than today).
    const day_start = (ms) => ms - (((ms % 86400000) + 86400000) % 86400000);
    const shared_from_ms = input.include_history
        ? null
        : (_b = input.share_from_ms) !== null && _b !== void 0 ? _b : day_start(now_ms - 12 * 3600000);
    const others = group.member_ids.filter((uid) => uid !== caller_id);
    if (others.length === 0) {
        return (0, types_1.success)({
            placement: {
                group_id: group.id,
                shared_from_ms,
                shared_by: caller_id,
                shared_at_ms: now_ms,
            },
            requests: [],
            duplicate_owner_id: null,
        });
    }
    const limit = (0, request_service_1.check_daily_recipient_limit)(input.sent_today, others, now_ms);
    if (limit.length)
        return (0, types_1.validation_failed)(limit);
    return (0, types_1.success)({
        placement: null,
        requests: others.map((to) => ({
            id: input.new_request_id(),
            type: "share_account",
            from_user_id: caller_id,
            to_user_id: to,
            group_id: group.id,
            target_id: account.id,
            target_label: account_label(account),
            shared_from_ms,
            status: "pending",
            created_at_ms: now_ms,
            expires_at_ms: now_ms + request_service_1.REQUEST_TTL_MS,
            responded_at_ms: null,
        })),
        duplicate_owner_id: null,
    });
}
/**
 * A member accepted a share request: the placement to apply, if the account is
 * still the sender's, still active, still private, the group still includes
 * both people, and nobody placed the same real account in the group meanwhile
 * (I4 re-checked at accept — S1-H1: two copies of one joint account can both be
 * waiting for an Accept; the second to be accepted is refused).
 *
 * `group_accounts` = accounts placed in the group NOW (read in the same
 * transaction as the placement write, so two accepts can't both pass).
 */
function placement_on_accept(request, account, group, now_ms, group_accounts = []) {
    if (request.type !== "share_account")
        return (0, types_1.validation_failed)(["Not a share request"]);
    if (!account ||
        !account.is_active ||
        account.user_id !== request.from_user_id ||
        account.id !== request.target_id) {
        return (0, types_1.validation_failed)(["This account is no longer available"]);
    }
    if (!(0, group_service_1.is_member)(group, request.from_user_id) || !(0, group_service_1.is_member)(group, request.to_user_id)) {
        return (0, types_1.validation_failed)(["This group has changed. Ask them to share again."]);
    }
    if (account.placement) {
        return account.placement.group_id === request.group_id
            ? (0, types_1.success)(account.placement) // another member accepted first
            : (0, types_1.validation_failed)(["This account is now shared somewhere else"]);
    }
    if (find_duplicate(account, group_accounts))
        return (0, types_1.validation_failed)([ALREADY_SHARED]);
    return (0, types_1.success)({
        group_id: request.group_id,
        shared_from_ms: request.shared_from_ms,
        shared_by: request.from_user_id,
        shared_at_ms: now_ms,
    });
}
/**
 * A share that applies at once (group of one) re-checked on the fresh data read in the
 * placement transaction (S1-H1): still the caller's, still private, and not the same real
 * account as one already placed in the group.
 */
function recheck_immediate_placement(placement, account, caller_id, group_accounts) {
    if (!account || !account.is_active || account.user_id !== caller_id || account.placement) {
        return (0, types_1.validation_failed)(["This account changed. Try again."]);
    }
    if (find_duplicate(account, group_accounts))
        return (0, types_1.validation_failed)([ALREADY_SHARED]);
    return (0, types_1.success)(placement);
}
/**
 * A removed account keeps its placement; restoring brings the placement back into effect, so it
 * passes the same rules as placing it (batch 10 verify H1). It stays shared only if the owner is
 * still in the group and no other copy of the real account went in meanwhile (I4); otherwise it
 * comes back private — the money counts once, and rejoining can't silently re-share it.
 *
 * `group_accounts` = accounts placed in the group NOW (read in the restore's transaction).
 */
function placement_on_restore(account, group, group_accounts) {
    if (!(account === null || account === void 0 ? void 0 : account.placement))
        return { keep: true, private_reason: null };
    if (!(0, group_service_1.is_member)(group, account.user_id)) {
        return {
            keep: false,
            private_reason: "Restored as private: you're no longer in that group.",
        };
    }
    // Shared before the owner's CURRENT membership: they left and rejoined since. No Accept is ever
    // skipped (departures clear this too; this covers accounts removed before they did).
    if (account.placement.shared_at_ms < group.members[account.user_id].joined_at_ms) {
        return {
            keep: false,
            private_reason: "Restored as private: you left that group after sharing this account.",
        };
    }
    if (find_duplicate(account, group_accounts)) {
        return {
            keep: false,
            private_reason: "Restored as private: someone in that group already shares this account.",
        };
    }
    return { keep: true, private_reason: null };
}
/** The owner makes an account private again. */
function plan_unshare_account(account, caller_id) {
    if (!account || account.user_id !== caller_id) {
        return (0, types_1.validation_failed)(["Only the account's owner can change its sharing"]);
    }
    if (!account.placement)
        return (0, types_1.validation_failed)(["This account is already private"]);
    return (0, types_1.success)({ was_group_id: account.placement.group_id });
}
/**
 * Accounts that leave a group when people leave it (D13). `leaving` = the uids
 * leaving, or "all" when the group is deleted. Returns account ids to make private.
 *
 * Derive must ALSO ignore any account whose owner isn't a current member, so a
 * failed write here can never keep someone's account visible after they leave.
 */
function placements_released(group_accounts, group_id, leaving) {
    return group_accounts
        .filter((a) => { var _a; return ((_a = a.placement) === null || _a === void 0 ? void 0 : _a.group_id) === group_id; })
        .filter((a) => leaving === "all" || leaving.includes(a.user_id))
        .map((a) => a.id);
}
/** Pending requests that die with a departure: anything from or to the leavers. */
function requests_released(pending, leaving) {
    return pending.filter((r) => leaving === "all" || leaving.includes(r.from_user_id) || leaving.includes(r.to_user_id));
}
//# sourceMappingURL=placement.service.js.map