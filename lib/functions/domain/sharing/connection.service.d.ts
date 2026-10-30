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
import { DomainResult } from "../../types";
/** Deterministic id for a pair: the two uids sorted. */
export declare function pair_id(a: string, b: string): string;
/** A new connection between two people. */
export declare function build_connection(a: string, b: string, now_ms: number): Connection;
/** The other person in a connection. */
export declare function other_user(connection: Connection, user_id: string): string;
/** True when the two people are connected (not blocked). */
export declare function is_connected(status: ConnectionStatus | null): boolean;
export type ConnectionAction = {
    action: "set_nickname";
    nickname: string;
} | {
    action: "disconnect";
} | {
    action: "block";
};
/** What applying an action does: an updated connection, or remove it. */
export interface ConnectionChange {
    connection: Connection | null;
}
/**
 * Applies a caller's action to a connection they're part of.
 *
 * - set_nickname: only while connected; empty clears it.
 * - disconnect: deletes the connection (they can reconnect with codes later);
 *   not allowed on a blocked pair (that would clear the block).
 * - block: marks blocked by the caller (stays blocked; no reconnecting).
 */
export declare function apply_connection_action(connection: Connection | null, caller_id: string, action: ConnectionAction): DomainResult<ConnectionChange>;
/** Builds a connection doc to block someone the caller isn't connected to yet. */
export declare function build_block_without_connection(caller_id: string, other_id: string, now_ms: number): Connection;
//# sourceMappingURL=connection.service.d.ts.map