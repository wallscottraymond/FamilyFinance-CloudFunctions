"use strict";
/**
 * Waitlist domain service (Website-Waitlist) — PURE: no IO, no clock, no logging.
 *
 * @module domain/waitlist/waitlist.service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.utc_day = utc_day;
exports.entry_id = entry_id;
exports.ip_limit_id = ip_limit_id;
exports.client_ip = client_ip;
exports.plan_join = plan_join;
const crypto_1 = require("crypto");
const waitlist_types_1 = require("../../types/waitlist.types");
function utc_day(now_ms) {
    return new Date(now_ms).toISOString().slice(0, 10);
}
function sha256(value) {
    return (0, crypto_1.createHash)("sha256").update(value).digest("hex");
}
/** Doc id for an (already lowercased) email: the same address can only ever be one entry. */
function entry_id(email) {
    return sha256(email);
}
/** Doc id for one network on one day. The address itself is never stored. */
function ip_limit_id(ip, day) {
    return sha256(`${day}:${ip}`);
}
/**
 * The client's address. Firebase Hosting puts it in `fastly-client-ip`. A direct call to the
 * function has no such header, so Cloud Run's own last `x-forwarded-for` hop is used. The header
 * can be forged on a direct call, which is why MAX_NEW_SIGNUPS_PER_DAY exists.
 */
function client_ip(fastly_client_ip, forwarded_for, fallback) {
    const fastly = fastly_client_ip === null || fastly_client_ip === void 0 ? void 0 : fastly_client_ip.trim();
    if (fastly)
        return fastly;
    const hops = (forwarded_for !== null && forwarded_for !== void 0 ? forwarded_for : "").split(",").map((h) => h.trim()).filter(Boolean);
    return hops[hops.length - 1] || fallback || "unknown";
}
function count_today(counter, day) {
    return counter && counter.day === day ? Math.max(0, counter.count) : 0;
}
/**
 * What a signup does. Every request that passes the network limit is counted, whether or not the
 * email is new, so repeated guessing is limited too. Only a new entry counts against the daily cap.
 */
function plan_join(input, state, now_ms) {
    const day = utc_day(now_ms);
    const limit_expires_at_ms = now_ms + waitlist_types_1.LIMIT_RETENTION_MS;
    const nothing = { entry: null, ip_counter: null, global_counter: null, limit_expires_at_ms };
    const attempts = count_today(state.ip_counter, day);
    if (attempts >= waitlist_types_1.MAX_ATTEMPTS_PER_IP_PER_DAY)
        return Object.assign({ status: "rate_limited" }, nothing);
    const ip_counter = { day, count: attempts + 1 };
    if (state.entry_exists)
        return Object.assign(Object.assign({ status: "already_joined" }, nothing), { ip_counter });
    const new_today = count_today(state.global_counter, day);
    if (new_today >= waitlist_types_1.MAX_NEW_SIGNUPS_PER_DAY) {
        return Object.assign(Object.assign({ status: "rate_limited" }, nothing), { ip_counter });
    }
    return {
        status: "joined",
        entry: { email: input.email, source: input.source, created_at_ms: now_ms },
        ip_counter,
        global_counter: { day, count: new_today + 1 },
        limit_expires_at_ms,
    };
}
//# sourceMappingURL=waitlist.service.js.map