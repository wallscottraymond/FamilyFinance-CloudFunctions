/**
 * Waitlist domain service (Website-Waitlist) — PURE: no IO, no clock, no logging.
 *
 * @module domain/waitlist/waitlist.service
 */

import { createHash } from "crypto";
import {
  JoinWaitlistInput,
  JoinWaitlistStatus,
  LIMIT_RETENTION_MS,
  MAX_ATTEMPTS_PER_IP_PER_DAY,
  MAX_NEW_SIGNUPS_PER_DAY,
  WaitlistDayCounter,
  WaitlistEntry,
} from "../../types/waitlist.types";

export function utc_day(now_ms: number): string {
  return new Date(now_ms).toISOString().slice(0, 10);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Doc id for an (already lowercased) email: the same address can only ever be one entry. */
export function entry_id(email: string): string {
  return sha256(email);
}

/** Doc id for one network on one day. The address itself is never stored. */
export function ip_limit_id(ip: string, day: string): string {
  return sha256(`${day}:${ip}`);
}

/**
 * The client's address. Firebase Hosting puts it in `fastly-client-ip`. A direct call to the
 * function has no such header, so Cloud Run's own last `x-forwarded-for` hop is used. The header
 * can be forged on a direct call, which is why MAX_NEW_SIGNUPS_PER_DAY exists.
 */
export function client_ip(
  fastly_client_ip: string | undefined,
  forwarded_for: string | undefined,
  fallback: string | undefined
): string {
  const fastly = fastly_client_ip?.trim();
  if (fastly) return fastly;
  const hops = (forwarded_for ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] || fallback || "unknown";
}

function count_today(counter: WaitlistDayCounter | null, day: string): number {
  return counter && counter.day === day ? Math.max(0, counter.count) : 0;
}

export interface JoinState {
  entry_exists: boolean;
  ip_counter: WaitlistDayCounter | null;
  global_counter: WaitlistDayCounter | null;
}

export interface JoinPlan {
  status: JoinWaitlistStatus;
  entry: WaitlistEntry | null;
  ip_counter: WaitlistDayCounter | null;
  global_counter: WaitlistDayCounter | null;
  limit_expires_at_ms: number;
}

/**
 * What a signup does. Every request that passes the network limit is counted, whether or not the
 * email is new, so repeated guessing is limited too. Only a new entry counts against the daily cap.
 */
export function plan_join(input: JoinWaitlistInput, state: JoinState, now_ms: number): JoinPlan {
  const day = utc_day(now_ms);
  const limit_expires_at_ms = now_ms + LIMIT_RETENTION_MS;
  const nothing = { entry: null, ip_counter: null, global_counter: null, limit_expires_at_ms };

  const attempts = count_today(state.ip_counter, day);
  if (attempts >= MAX_ATTEMPTS_PER_IP_PER_DAY) return { status: "rate_limited", ...nothing };

  const ip_counter = { day, count: attempts + 1 };
  if (state.entry_exists) return { status: "already_joined", ...nothing, ip_counter };

  const new_today = count_today(state.global_counter, day);
  if (new_today >= MAX_NEW_SIGNUPS_PER_DAY) {
    return { status: "rate_limited", ...nothing, ip_counter };
  }

  return {
    status: "joined",
    entry: { email: input.email, source: input.source, created_at_ms: now_ms },
    ip_counter,
    global_counter: { day, count: new_today + 1 },
    limit_expires_at_ms,
  };
}
