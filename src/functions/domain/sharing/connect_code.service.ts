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
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const COOLDOWN_MS = 15 * 60 * 1000;
export const MAX_CONNECTIONS = 10;

/**
 * Builds a code from CODE_LENGTH random integers (any non-negative ints; each is
 * reduced into the alphabet).
 */
export function build_code(random_ints: number[]): string {
  if (random_ints.length < CODE_LENGTH) {
    throw new Error(`build_code needs ${CODE_LENGTH} random ints`);
  }
  return random_ints
    .slice(0, CODE_LENGTH)
    .map((n) => CODE_ALPHABET[Math.abs(Math.trunc(n)) % CODE_ALPHABET.length])
    .join("");
}

/** A fresh code for a user (clears entries; keeps their failure state). */
export function build_connect_code(
  user_id: string,
  code: string,
  now_ms: number,
  previous: ConnectCode | null
): ConnectCode {
  return {
    user_id,
    code,
    expires_at_ms: now_ms + CODE_TTL_MS,
    entries: {},
    failed_attempts: previous?.failed_attempts ?? 0,
    cooldown_until_ms: previous?.cooldown_until_ms ?? 0,
  };
}

/**
 * Normalizes what someone typed: uppercase, spaces/dashes removed, and the
 * look-alikes people commonly type (O→0 isn't in the alphabet, so O stays O;
 * lowercase l and I read as 1 which also isn't used) are left for validation.
 * Returns null when it can't be a code.
 */
export function normalize_entered_code(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

export type CodeEntryOutcome =
  | "cooldown" //        too many wrong codes: wait
  | "invalid" //         no such code, or it expired
  | "self" //            typed their own code
  | "unavailable" //     blocked pair: shown as a generic failure
  | "already_connected"
  | "limit_self" //      caller has 10 connections
  | "limit_other" //     the other person has 10 connections
  | "waiting" //         recorded; the other person still needs to type the caller's code
  | "connected"; //      both have typed each other's code

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
export function evaluate_code_entry(input: CodeEntryInput): CodeEntryDecision {
  const none = { other_user_id: null, record_failure: false, record_entry: false };
  const caller_state = input.caller_code;

  if (caller_state && caller_state.cooldown_until_ms > input.now_ms) {
    return { outcome: "cooldown", ...none };
  }
  const target = input.target;
  if (!target || target.expires_at_ms <= input.now_ms) {
    return { outcome: "invalid", ...none, record_failure: true };
  }
  const other = target.user_id;
  if (other === input.caller_id) {
    return { outcome: "self", ...none };
  }
  const with_other = { other_user_id: other, record_failure: false, record_entry: false };
  if (input.existing_connection_status === "blocked") {
    return { outcome: "unavailable", ...with_other };
  }
  if (input.existing_connection_status === "connected") {
    return { outcome: "already_connected", ...with_other };
  }
  if (input.caller_connection_count >= MAX_CONNECTIONS) {
    return { outcome: "limit_self", ...with_other };
  }
  if (input.target_connection_count >= MAX_CONNECTIONS) {
    return { outcome: "limit_other", ...with_other };
  }

  // Did the other person already type the caller's (still valid) code?
  const their_entry_ms = caller_state?.entries[other];
  const caller_code_valid = !!caller_state && caller_state.expires_at_ms > input.now_ms;
  const typed_mine_recently =
    their_entry_ms !== undefined && input.now_ms - their_entry_ms <= CODE_TTL_MS;
  if (caller_code_valid && typed_mine_recently) {
    return { outcome: "connected", ...with_other };
  }
  return { outcome: "waiting", ...with_other, record_entry: true };
}

/** Failure bookkeeping after a wrong code: returns the new counters. */
export function apply_failure(
  failed_attempts: number,
  now_ms: number
): { failed_attempts: number; cooldown_until_ms: number } {
  const next = failed_attempts + 1;
  if (next >= MAX_FAILED_ATTEMPTS) {
    return { failed_attempts: 0, cooldown_until_ms: now_ms + COOLDOWN_MS };
  }
  return { failed_attempts: next, cooldown_until_ms: 0 };
}
