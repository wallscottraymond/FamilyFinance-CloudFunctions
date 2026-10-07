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

import { Connection, ConnectionStatus } from "../../types/sharing.types";
import { DomainResult, success, validation_failed } from "../../types";
import { normalize_nickname } from "./names.service";

/** Deterministic id for a pair: the two uids sorted. */
export function pair_id(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

/** A new connection between two people. */
export function build_connection(a: string, b: string, now_ms: number): Connection {
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
export function other_user(connection: Connection, user_id: string): string {
  return connection.user_ids[0] === user_id ? connection.user_ids[1] : connection.user_ids[0];
}

/** True when the two people are connected (not blocked). */
export function is_connected(status: ConnectionStatus | null): boolean {
  return status === "connected";
}

export type ConnectionAction =
  | { action: "set_nickname"; nickname: string }
  | { action: "disconnect" }
  | { action: "block" };

/** What applying an action does: an updated connection, or remove it. */
export interface ConnectionChange {
  connection: Connection | null; // null = delete the doc
}

/**
 * Applies a caller's action to a connection they're part of.
 *
 * - set_nickname: only while connected; empty clears it.
 * - disconnect: deletes the connection (they can reconnect with codes later);
 *   not allowed on a blocked pair (that would clear the block).
 * - block: marks blocked by the caller (stays blocked; no reconnecting).
 */
export function apply_connection_action(
  connection: Connection | null,
  caller_id: string,
  action: ConnectionAction
): DomainResult<ConnectionChange> {
  if (!connection || !connection.user_ids.includes(caller_id)) {
    return validation_failed(["You're not connected with this person"]);
  }
  switch (action.action) {
  case "set_nickname": {
    if (connection.status !== "connected") {
      return validation_failed(["You're not connected with this person"]);
    }
    const { nickname, error } = normalize_nickname(action.nickname);
    if (error) return validation_failed([error]);
    const nicknames = { ...connection.nicknames };
    if (nickname) nicknames[caller_id] = nickname;
    else delete nicknames[caller_id];
    return success({ connection: { ...connection, nicknames } });
  }
  case "disconnect": {
    if (connection.status === "blocked") {
      return validation_failed(["This person is blocked"]);
    }
    return success({ connection: null });
  }
  case "block": {
    if (connection.status === "blocked") {
      return success({ connection });
    }
    return success({
      connection: { ...connection, status: "blocked", blocked_by: caller_id, nicknames: {} },
    });
  }
  }
}

/** Builds a connection doc to block someone the caller isn't connected to yet. */
export function build_block_without_connection(
  caller_id: string,
  other_id: string,
  now_ms: number
): Connection {
  return {
    ...build_connection(caller_id, other_id, now_ms),
    status: "blocked",
    blocked_by: caller_id,
  };
}
