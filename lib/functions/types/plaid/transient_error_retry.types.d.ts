/**
 * Transient Error Auto-Retry Types
 *
 * Types for the scheduled job that silently retries Plaid items in a transient
 * error state (institution down, rate limited, internal error). The item is
 * retried in the background and only surfaced to the user if the failure
 * persists past the surface threshold.
 *
 * @module types/plaid/transient_error_retry
 */
import { Timestamp } from "firebase-admin/firestore";
/** How often the scheduled retry job runs (every 4 hours). */
export declare const RETRY_SCHEDULE = "0 */4 * * *";
/**
 * How long a transient error may persist (silently retried) before it is
 * surfaced to the user as needing a reconnect. 24 hours.
 */
export declare const SURFACE_AFTER_MS: number;
/** Max items processed per scheduled run (safety bound). */
export declare const MAX_ITEMS_PER_RUN = 200;
/** Performance budget for the retry orchestrator (per item is small; this is the run). */
export declare const RETRY_TRANSIENT_ERRORS_BUDGET: {
    max_reads: number;
    max_writes: number;
    max_time_ms: number;
};
/**
 * A Plaid item currently in a transient error state, awaiting silent retry.
 */
export interface TransientItemToRetry {
    /** Firestore document ID */
    item_doc_id: string;
    /** Plaid's item ID (what the sync probe needs) */
    plaid_item_id: string;
    /** Owning user */
    user_id: string;
    /** Current (transient) status */
    status: string;
    /** The original transient error code, if recorded */
    error_code: string | null;
    /** When the item first entered the transient state (the surface-window anchor) */
    transient_since: Timestamp | null;
}
/** What to do with a transient item after a retry probe. */
export type RetryAction = "recovered" | "keep_waiting" | "escalate";
/** Pure input for the retry decision. */
export interface RetryDecisionInput {
    /** When the item first entered the transient state, in epoch ms (null = unknown). */
    transient_since_ms: number | null;
    /** Current time in epoch ms (injected for determinism). */
    now_ms: number;
    /** Whether the balance-sync probe succeeded. */
    sync_succeeded: boolean;
    /** How long a transient failure may persist before surfacing. */
    surface_after_ms: number;
}
/** Aggregated result of one scheduled retry run. */
export interface RetryTransientErrorsResponse {
    /** Items examined this run. */
    processed: number;
    /** Items that recovered (sync succeeded → healthy). */
    recovered: number;
    /** Items still failing but within the silent window. */
    still_waiting: number;
    /** Items escalated to the user (failing past the surface threshold). */
    escalated: number;
}
//# sourceMappingURL=transient_error_retry.types.d.ts.map