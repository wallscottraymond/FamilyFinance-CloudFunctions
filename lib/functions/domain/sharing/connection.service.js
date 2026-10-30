"use strict";
/**
 * Connections (D24, D27, D28)
 *
 * A connection is created only when both people typed each other's code. Each
 * person can give the other a private nickname, disconnect, or block (a blocked
 * pair can't reconnect or send requests).
 *
 * PURE: no IO.
 *
 * @module domain/sharing/connection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pair_id = pair_id;
exports.build_connection = build_connection;
exports.other_user = other_user;
exports.is_connected = is_connected;
exports.apply_connection_action = apply_connection_action;
exports.build_block_without_connection = build_block_without_connection;
const types_1 = require("../../types");
const names_service_1 = require("./names.service");
/** Deterministic id for a pair: the two uids sorted. */
function pair_id(a, b) {
    return a < b ? `${a}__${b}` : `${b}__${a}`;
}
/** A new connection between two people. */
function build_connection(a, b, now_ms) {
    const [first, second] = a < b ? [a, b] : [b, a];
    return {
        id: pair_id(a, b),
        user_ids: [first, second],
        status: "connected",
        connected_at_ms: now_ms,
        blocked_by: null,
        nicknames: {},
    };
}
/** The other person in a connection. */
function other_user(connection, user_id) {
    return connection.user_ids[0] === user_id ? connection.user_ids[1] : connection.user_ids[0];
}
/** True when the two people are connected (not blocked). */
function is_connected(status) {
    return status === "connected";
}
/**
 * Applies a caller's action to a connection they're part of.
 *
 * - set_nickname: only while connected; empty clears it.
 * - disconnect: deletes the connection (they can reconnect with codes later);
 *   not allowed on a blocked pair (that would clear the block).
 * - block: marks blocked by the caller (stays blocked; no reconnecting).
 */
function apply_connection_action(connection, caller_id, action) {
    if (!connection || !connection.user_ids.includes(caller_id)) {
        return (0, types_1.validation_failed)(["You're not connected with this person"]);
    }
    switch (action.action) {
        case "set_nickname": {
            if (connection.status !== "connected") {
                return (0, types_1.validation_failed)(["You're not connected with this person"]);
            }
            const { nickname, error } = (0, names_service_1.normalize_nickname)(action.nickname);
            if (error)
                return (0, types_1.validation_failed)([error]);
            const nicknames = Object.assign({}, connection.nicknames);
            if (nickname)
                nicknames[caller_id] = nickname;
            else
                delete nicknames[caller_id];
            return (0, types_1.success)({ connection: Object.assign(Object.assign({}, connection), { nicknames }) });
        }
        case "disconnect": {
            if (connection.status === "blocked") {
                return (0, types_1.validation_failed)(["This person is blocked"]);
            }
            return (0, types_1.success)({ connection: null });
        }
        case "block": {
            if (connection.status === "blocked") {
                return (0, types_1.success)({ connection });
            }
            return (0, types_1.success)({
                connection: Object.assign(Object.assign({}, connection), { status: "blocked", blocked_by: caller_id, nicknames: {} }),
            });
        }
    }
}
/** Builds a connection doc to block someone the caller isn't connected to yet. */
function build_block_without_connection(caller_id, other_id, now_ms) {
    return Object.assign(Object.assign({}, build_connection(caller_id, other_id, now_ms)), { status: "blocked", blocked_by: caller_id });
}
//# sourceMappingURL=connection.service.js.map