/**
 * Purge Guard + Status
 *
 * Shared home for the `purge_status/{uid}` doc: its shape, the guard read
 * (`is_user_purging`) that background paths (Plaid sync, webhooks) check to avoid
 * re-populating a user who is being erased, and a small upsert helper.
 *
 * Kept in `infrastructure` (not a repository) because the guard read is called
 * from entry/orchestrator layers that must NOT depend on the full repo surface,
 * and it is a single-doc read/write with no domain logic.
 *
 * @module infrastructure/purge_guard
 */
import { Timestamp } from "firebase-admin/firestore";
/** The per-user purge status doc lives at `purge_status/{uid}`. */
export declare const PURGE_STATUS_COLLECTION = "purge_status";
/**
 * Lifecycle of a purge:
 * - `blocked`   — pre-check refused (e.g. user owns a group with other members); purge did NOT start.
 * - `requested` — enqueued, job not yet running.
 * - `running`   — the purge job is deleting.
 * - `done`      — all Firestore data + (best-effort) the auth user removed.
 * - `failed`    — the job errored; safe to retry (idempotent).
 */
export type PurgeState = "blocked" | "requested" | "running" | "done" | "failed";
/** Per-collection delete progress (for the live FE progress view). */
export interface PurgeCollectionProgress {
    deleted: number;
}
/** The `purge_status/{uid}` document. */
export interface PurgeStatus {
    user_id: string;
    state: PurgeState;
    /** Who kicked it off (self uid, or an admin uid). */
    initiated_by: string;
    /** Reason when `state === "blocked"` (e.g. "owns_group_with_members"). */
    blocked_reason?: string;
    /** Groups (id + name) blocking the purge, for the FE message. */
    blocked_groups?: Array<{
        id: string;
        name: string;
    }>;
    /** Per-collection deleted counts, keyed by collection name. */
    counts?: Record<string, PurgeCollectionProgress>;
    /** Human-readable label of the phase currently running (for the FE tracker). */
    current_step?: string;
    /** Running total of records deleted so far (advances DURING big sweeps). */
    total_deleted?: number;
    /** Firestore data is gone but the Firebase Auth user couldn't be deleted yet. */
    auth_delete_pending?: boolean;
    /** Human-readable failure reason when `state === "failed"`. */
    error_message?: string;
    started_at?: Timestamp;
    updated_at: Timestamp;
    finished_at?: Timestamp;
}
/**
 * Whether a user is mid- or post-purge, so background writers should abort.
 *
 * True for `requested | running | done` — i.e. once a purge is in flight or has
 * completed, nothing should recreate the user's data. `blocked`/`failed` do NOT
 * block (the purge didn't run / can be retried).
 */
export declare function is_user_purging(user_id: string): Promise<boolean>;
/**
 * Upsert a patch onto `purge_status/{uid}` (always stamps `updated_at`).
 * Merge-write so partial progress updates don't clobber prior fields.
 */
export declare function set_purge_status(user_id: string, patch: Partial<PurgeStatus>): Promise<void>;
//# sourceMappingURL=purge_guard.d.ts.map