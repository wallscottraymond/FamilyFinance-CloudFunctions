/**
 * Waitlist types (Website-Waitlist).
 *
 * @module types/waitlist
 */

import { z } from "zod";

/** Requests one network may make per UTC day (new signups and repeats alike). */
export const MAX_ATTEMPTS_PER_IP_PER_DAY = 10;
/** New signups accepted per UTC day: the ceiling on writes if the network limit is dodged. */
export const MAX_NEW_SIGNUPS_PER_DAY = 1000;
/** How long a per-network counter lives: past its own day, then TTL removes it. */
export const LIMIT_RETENTION_MS = 2 * 86_400_000;

export const join_waitlist_input_schema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  /** Which form was used: a fixed list, so nothing free-form is stored. */
  source: z.enum(["hero", "footer"]).default("hero"),
  /** Honeypot: hidden from people, so a value here means a bot. */
  company: z.string().max(500).optional(),
});

export type JoinWaitlistInput = z.infer<typeof join_waitlist_input_schema>;

export interface WaitlistEntry {
  email: string;
  source: JoinWaitlistInput["source"];
  created_at_ms: number;
}

/** A counter for one UTC day; a counter from an earlier day counts as 0. */
export interface WaitlistDayCounter {
  day: string;
  count: number;
}

export type JoinWaitlistStatus = "joined" | "already_joined" | "ignored" | "rate_limited";
