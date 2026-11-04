/**
 * Waitlist domain service (Website-Waitlist) — PURE: no IO, no clock, no logging.
 *
 * @module domain/waitlist/waitlist.service
 */
import { JoinWaitlistInput, JoinWaitlistStatus, WaitlistDayCounter, WaitlistEntry } from "../../types/waitlist.types";
export declare function utc_day(now_ms: number): string;
/** Doc id for an (already lowercased) email: the same address can only ever be one entry. */
export declare function entry_id(email: string): string;
/** Doc id for one network on one day. The address itself is never stored. */
export declare function ip_limit_id(ip: string, day: string): string;
/**
 * The client's address. Firebase Hosting puts it in `fastly-client-ip`. A direct call to the
 * function has no such header, so Cloud Run's own last `x-forwarded-for` hop is used. The header
 * can be forged on a direct call, which is why MAX_NEW_SIGNUPS_PER_DAY exists.
 */
export declare function client_ip(fastly_client_ip: string | undefined, forwarded_for: string | undefined, fallback: string | undefined): string;
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
export declare function plan_join(input: JoinWaitlistInput, state: JoinState, now_ms: number): JoinPlan;
//# sourceMappingURL=waitlist.service.d.ts.map