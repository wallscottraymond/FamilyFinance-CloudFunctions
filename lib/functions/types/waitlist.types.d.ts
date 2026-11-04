/**
 * Waitlist types (Website-Waitlist).
 *
 * @module types/waitlist
 */
import { z } from "zod";
/** Requests one network may make per UTC day (new signups and repeats alike). */
export declare const MAX_ATTEMPTS_PER_IP_PER_DAY = 10;
/** New signups accepted per UTC day: the ceiling on writes if the network limit is dodged. */
export declare const MAX_NEW_SIGNUPS_PER_DAY = 1000;
/** How long a per-network counter lives: past its own day, then TTL removes it. */
export declare const LIMIT_RETENTION_MS: number;
export declare const join_waitlist_input_schema: z.ZodObject<{
    email: z.ZodString;
    source: z.ZodDefault<z.ZodEnum<{
        hero: "hero";
        footer: "footer";
    }>>;
    company: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
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
//# sourceMappingURL=waitlist.types.d.ts.map