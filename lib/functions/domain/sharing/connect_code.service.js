"use strict";
/**
 * Connect Codes (D24, D29)
 *
 * Two people connect only when EACH types the other's short code. A code alone
 * shares nothing; it opens the door for groups and requests. Codes expire after
 * 10 minutes, and five wrong entries in a row pause entering for 15 minutes.
 *
 * PURE: randomness and time are passed in.
 *
 * @module domain/sharing/connect_code
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_CODE_REMAINING_MS = exports.MAX_CONNECTIONS = exports.COOLDOWN_MS = exports.MAX_FAILED_ATTEMPTS = exports.CODE_TTL_MS = exports.CODE_LENGTH = exports.CODE_ALPHABET = void 0;
exports.build_code = build_code;
exports.build_connect_code = build_connect_code;
exports.normalize_entered_code = normalize_entered_code;
exports.evaluate_code_entry = evaluate_code_entry;
exports.apply_failure = apply_failure;
exports.should_issue_new_code = should_issue_new_code;
/** No 0/O, 1/I/L: easy to read aloud and type. */
exports.CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
exports.CODE_LENGTH = 6;
exports.CODE_TTL_MS = 10 * 60 * 1000;
exports.MAX_FAILED_ATTEMPTS = 5;
exports.COOLDOWN_MS = 15 * 60 * 1000;
exports.MAX_CONNECTIONS = 10;
/**
 * Builds a code from CODE_LENGTH random integers (any non-negative ints; each is
 * reduced into the alphabet).
 */
function build_code(random_ints) {
    if (random_ints.length < exports.CODE_LENGTH) {
        throw new Error(`build_code needs ${exports.CODE_LENGTH} random ints`);
    }
    return random_ints
        .slice(0, exports.CODE_LENGTH)
        .map((n) => exports.CODE_ALPHABET[Math.abs(Math.trunc(n)) % exports.CODE_ALPHABET.length])
        .join("");
}
/** A fresh code for a user (clears entries; keeps their failure state). */
function build_connect_code(user_id, code, now_ms, previous) {
    var _a, _b;
    return {
        user_id,
        code,
        expires_at_ms: now_ms + exports.CODE_TTL_MS,
        entries: {},
        failed_attempts: (_a = previous === null || previous === void 0 ? void 0 : previous.failed_attempts) !== null && _a !== void 0 ? _a : 0,
        cooldown_until_ms: (_b = previous === null || previous === void 0 ? void 0 : previous.cooldown_until_ms) !== null && _b !== void 0 ? _b : 0,
    };
}
/**
 * Normalizes what someone typed: uppercase, spaces/dashes removed, and the
 * look-alikes people commonly type (O→0 isn't in the alphabet, so O stays O;
 * lowercase l and I read as 1 which also isn't used) are left for validation.
 * Returns null when it can't be a code.
 */
function normalize_entered_code(raw) {
    const code = raw.toUpperCase().replace(/[\s-]/g, "");
    if (code.length !== exports.CODE_LENGTH)
        return null;
    for (const ch of code) {
        if (!exports.CODE_ALPHABET.includes(ch))
            return null;
    }
    return code;
}
/** Decides what typing a code does. */
function evaluate_code_entry(input) {
    const none = { other_user_id: null, record_failure: false, record_entry: false };
    const caller_state = input.caller_code;
    if (caller_state && caller_state.cooldown_until_ms > input.now_ms) {
        return Object.assign({ outcome: "cooldown" }, none);
    }
    const target = input.target;
    if (!target || target.expires_at_ms <= input.now_ms) {
        return Object.assign(Object.assign({ outcome: "invalid" }, none), { record_failure: true });
    }
    const other = target.user_id;
    if (other === input.caller_id) {
        return Object.assign({ outcome: "self" }, none);
    }
    const with_other = { other_user_id: other, record_failure: false, record_entry: false };
    if (input.existing_connection_status === "blocked") {
        return Object.assign({ outcome: "unavailable" }, with_other);
    }
    if (input.existing_connection_status === "connected") {
        return Object.assign({ outcome: "already_connected" }, with_other);
    }
    if (input.caller_connection_count >= exports.MAX_CONNECTIONS) {
        return Object.assign({ outcome: "limit_self" }, with_other);
    }
    if (input.target_connection_count >= exports.MAX_CONNECTIONS) {
        return Object.assign({ outcome: "limit_other" }, with_other);
    }
    // Did the other person already type the caller's (still valid) code?
    const their_entry_ms = caller_state === null || caller_state === void 0 ? void 0 : caller_state.entries[other];
    const caller_code_valid = !!caller_state && caller_state.expires_at_ms > input.now_ms;
    const typed_mine_recently = their_entry_ms !== undefined && input.now_ms - their_entry_ms <= exports.CODE_TTL_MS;
    if (caller_code_valid && typed_mine_recently) {
        return Object.assign({ outcome: "connected" }, with_other);
    }
    return Object.assign(Object.assign({ outcome: "waiting" }, with_other), { record_entry: true });
}
/** Failure bookkeeping after a wrong code: returns the new counters. */
function apply_failure(failed_attempts, now_ms) {
    const next = failed_attempts + 1;
    if (next >= exports.MAX_FAILED_ATTEMPTS) {
        return { failed_attempts: 0, cooldown_until_ms: now_ms + exports.COOLDOWN_MS };
    }
    return { failed_attempts: next, cooldown_until_ms: 0 };
}
/** Codes with less than this left are replaced instead of shown again. */
exports.MIN_CODE_REMAINING_MS = 60 * 1000;
/** Show the existing code unless asked for a new one or it's (nearly) expired. */
function should_issue_new_code(existing, now_ms, refresh) {
    if (refresh || !existing || !existing.code)
        return true;
    return existing.expires_at_ms - now_ms < exports.MIN_CODE_REMAINING_MS;
}
//# sourceMappingURL=connect_code.service.js.map