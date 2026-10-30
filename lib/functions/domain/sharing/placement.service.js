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
/** Decides what sharing an account with a group does. */
function plan_share_account(input) {
    var _a;
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
    const fp = account_fingerprint(account);
    const dup = fp
        ? input.group_accounts.find((g) => g.id !== account.id && account_fingerprint(g) === fp)
        : undefined;
    if (dup) {
        return {
            entity: { placement: null, requests: [], duplicate_owner_id: dup.user_id },
            validation_errors: ["Someone in this group already shares this account"],
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
        : (_a = input.share_from_ms) !== null && _a !== void 0 ? _a : day_start(now_ms - 12 * 3600000);
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
 * still the sender's, still active, still private, and the group still includes
 * both people.
 */
function placement_on_accept(request, account, group, now_ms) {
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
    return (0, types_1.success)({
        group_id: request.group_id,
        shared_from_ms: request.shared_from_ms,
        shared_by: request.from_user_id,
        shared_at_ms: now_ms,
    });
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