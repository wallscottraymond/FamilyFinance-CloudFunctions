/**
 * Connect Code Repository (D24)
 *
 * `connect_codes/{uid}`: the user's current code, who has typed it, and their
 * wrong-code counters. Functions-only (rules deny clients). `expireAt` is a TTL
 * field (policy: delete a day after the code expires).
 *
 * @module repositories/sharing/connect_code
 */
import { TraceContext } from "../../types";
import { ConnectCode } from "../../types/sharing.types";
export declare const connect_code_repo: {
    /** The user's code doc, or null. */
    get_by_user(_ctx: TraceContext, user_id: string): Promise<ConnectCode | null>;
    /** Unexpired code docs with this code (normally 0 or 1). */
    find_active_by_code(_ctx: TraceContext, code: string, now_ms: number): Promise<ConnectCode[]>;
    /** Replaces the user's code doc. */
    save(_ctx: TraceContext, entity: ConnectCode, now_ms: number): Promise<void>;
    /** Records that `entrant_id` typed `owner_id`'s code (idempotent map write). */
    record_entry(_ctx: TraceContext, owner_id: string, entrant_id: string, at_ms: number): Promise<void>;
    /** Sets the wrong-code counters for a user (creates the doc if needed). */
    set_failure_state(_ctx: TraceContext, user_id: string, failed_attempts: number, cooldown_until_ms: number, now_ms: number): Promise<void>;
    /** Removes the user's code doc (account purge). */
    delete(_ctx: TraceContext, user_id: string): Promise<void>;
    /** Expires both people's codes once they've connected (codes are single-use). */
    expire_codes(_ctx: TraceContext, user_ids: string[], now_ms: number): Promise<void>;
};
//# sourceMappingURL=connect_code.repo.d.ts.map