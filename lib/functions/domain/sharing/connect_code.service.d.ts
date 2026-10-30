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
import { ConnectCode, ConnectionStatus } from "../../types/sharing.types";
/** No 0/O, 1/I/L: easy to read aloud and type. */
export declare const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export declare const CODE_LENGTH = 6;
export declare const CODE_TTL_MS: number;
export declare const MAX_FAILED_ATTEMPTS = 5;
export declare const COOLDOWN_MS: number;
export declare const MAX_CONNECTIONS = 10;
/**
 * Builds a code from CODE_LENGTH random integers (any non-negative ints; each is
 * reduced into the alphabet).
 */
export declare function build_code(random_ints: number[]): string;
/** A fresh code for a user (clears entries; keeps their failure state). */
export declare function build_connect_code(user_id: string, code: string, now_ms: number, previous: ConnectCode | null): ConnectCode;
/**
 * Normalizes what someone typed: uppercase, spaces/dashes removed, and the
 * look-alikes people commonly type (O→0 isn't in the alphabet, so O stays O;
 * lowercase l and I read as 1 which also isn't used) are left for validation.
 * Returns null when it can't be a code.
 */
export declare function normalize_entered_code(raw: string): string | null;
export type CodeEntryOutcome = "cooldown" | "invalid" | "self" | "unavailable" | "already_connected" | "limit_self" | "limit_other" | "waiting" | "connected";
export interface CodeEntryInput {
    caller_id: string;
    now_ms: number;
    /** The code doc whose code was typed (null when no active code matches). */
    target: ConnectCode | null;
    /** The caller's own code doc (holds who has typed the caller's code). */
    caller_code: ConnectCode | null;
    existing_connection_status: ConnectionStatus | null;
    caller_connection_count: number;
    target_connection_count: number;
}
export interface CodeEntryDecision {
    outcome: CodeEntryOutcome;
    /** The other person (when the code matched someone). */
    other_user_id: string | null;
    /** Count this as a wrong entry (bumps failed_attempts, may start a cooldown). */
    record_failure: boolean;
    /** Record that the caller typed the target's code. */
    record_entry: boolean;
}
/** Decides what typing a code does. */
export declare function evaluate_code_entry(input: CodeEntryInput): CodeEntryDecision;
/** Failure bookkeeping after a wrong code: returns the new counters. */
export declare function apply_failure(failed_attempts: number, now_ms: number): {
    failed_attempts: number;
    cooldown_until_ms: number;
};
/** Codes with less than this left are replaced instead of shown again. */
export declare const MIN_CODE_REMAINING_MS: number;
/** Show the existing code unless asked for a new one or it's (nearly) expired. */
export declare function should_issue_new_code(existing: ConnectCode | null, now_ms: number, refresh: boolean): boolean;
//# sourceMappingURL=connect_code.service.d.ts.map