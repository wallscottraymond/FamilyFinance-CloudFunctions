/**
 * Purge User Data Entry Point
 *
 * Callable that kicks off a FULL, PERMANENT erase of a user. It does NOT delete
 * anything itself (a large user would time out) — it validates, blocks unsafe
 * cases, writes the `purge_status/{uid}` doc, and enqueues the async
 * `purge_user_data` job. The FE listens to the status doc for live progress.
 *
 * Auth: a user may purge their OWN uid; an ADMIN (custom claim) may purge any
 * uid. A fixed confirmation phrase is re-checked server-side (defense in depth).
 *
 * Groups: if the target owns a group with other members, the purge is BLOCKED
 * (status `blocked` + the group list returned) so a shared group is never
 * orphaned — the user must transfer ownership first.
 *
 * @module entry/callable/purge_user_data
 */
import { FunctionResponse } from "../../types";
interface PurgeUserDataResponseData {
    /** True when the purge was refused (e.g. owns a shared group). */
    blocked: boolean;
    /** Reason when blocked. */
    blocked_reason?: string;
    /** Groups blocking the purge (id + name) — for the FE message. */
    blocked_groups?: Array<{
        id: string;
        name: string;
    }>;
    /** The uid being purged. */
    user_id: string;
    /** Path of the live status doc the FE subscribes to. */
    status_doc_path: string;
}
export declare const purge_user_data: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<PurgeUserDataResponseData>>, unknown>;
export {};
//# sourceMappingURL=purge_user_data.entry.d.ts.map