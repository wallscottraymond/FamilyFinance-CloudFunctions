"use strict";
/**
 * Requests (D25, D26)
 *
 * Every offer (v1: "join this group") reaches the other person as a request they
 * accept or decline. Requests expire after 7 days. A sender can send to at most
 * 5 different people per rolling 24 hours, so nobody can mass-spam offers.
 *
 * PURE: ids and time are passed in.
 *
 * @module domain/sharing/request
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REPORT_REASON_LENGTH = exports.DAY_MS = exports.DAILY_RECIPIENT_LIMIT = exports.REQUEST_TTL_MS = void 0;
exports.check_daily_recipient_limit = check_daily_recipient_limit;
exports.build_join_request = build_join_request;
exports.is_open = is_open;
exports.answer_request = answer_request;
exports.cancel_requests = cancel_requests;
exports.build_report = build_report;
const types_1 = require("../../types");
exports.REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
exports.DAILY_RECIPIENT_LIMIT = 5;
exports.DAY_MS = 24 * 60 * 60 * 1000;
exports.MAX_REPORT_REASON_LENGTH = 500;
/**
 * Checks the 5-people-a-day limit. `recent` = requests this sender created in the
 * last 24h. A person already sent to today doesn't count again.
 */
function check_daily_recipient_limit(recent, new_recipients, now_ms) {
    const today = new Set(recent.filter((r) => now_ms - r.created_at_ms < exports.DAY_MS).map((r) => r.to_user_id));
    for (const uid of new_recipients)
        today.add(uid);
    if (today.size > exports.DAILY_RECIPIENT_LIMIT) {
        return [
            `You can send to up to ${exports.DAILY_RECIPIENT_LIMIT} people a day. Try again tomorrow.`,
        ];
    }
    return [];
}
/** A pending join request. */
function build_join_request(id, from_user_id, to_user_id, group_id, now_ms) {
    return {
        id,
        type: "join_group",
        from_user_id,
        to_user_id,
        group_id,
        target_id: null,
        target_label: null,
        shared_from_ms: null,
        status: "pending",
        created_at_ms: now_ms,
        expires_at_ms: now_ms + exports.REQUEST_TTL_MS,
        responded_at_ms: null,
    };
}
/** True while a request can still be answered. */
function is_open(request, now_ms) {
    return request.status === "pending" && request.expires_at_ms > now_ms;
}
/**
 * Validates that the caller may answer this request and returns it with the
 * answer applied. Group-side checks (limits, membership) happen separately.
 */
function answer_request(request, caller_id, accept, now_ms) {
    if (!request || request.to_user_id !== caller_id) {
        return (0, types_1.validation_failed)(["This request isn't available"]);
    }
    if (!is_open(request, now_ms)) {
        return (0, types_1.validation_failed)(["This request has expired or was already answered"]);
    }
    return (0, types_1.success)(Object.assign(Object.assign({}, request), { status: accept ? "accepted" : "declined", responded_at_ms: now_ms }));
}
/** Marks requests cancelled (e.g. the group was deleted, or the pair got blocked). */
function cancel_requests(requests, now_ms) {
    return requests
        .filter((r) => r.status === "pending")
        .map((r) => (Object.assign(Object.assign({}, r), { status: "cancelled", responded_at_ms: now_ms })));
}
/** A report of another person (D27). */
function build_report(id, reporter_id, reported_id, reason, now_ms) {
    const text = reason.trim();
    if (reporter_id === reported_id)
        return (0, types_1.validation_failed)(["You can't report yourself"]);
    if (text.length > exports.MAX_REPORT_REASON_LENGTH) {
        return (0, types_1.validation_failed)([`Keep it under ${exports.MAX_REPORT_REASON_LENGTH} characters`]);
    }
    return (0, types_1.success)({
        id,
        reporter_id,
        reported_id,
        reason: text,
        created_at_ms: now_ms,
    });
}
//# sourceMappingURL=request.service.js.map