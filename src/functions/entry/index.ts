/**
 * Entry Layer
 *
 * Cloud Function entry points that translate external requests
 * into internal system calls.
 *
 * @module entry
 */

// Callable functions (user-initiated via httpsCallable)
export * from "./callable";

// HTTP functions (webhook endpoints)
export * from "./http";

// Firestore triggers (document-change initiated)
export * from "./triggers";

// Scheduled fallback worker for the job queue (retries failed/missed jobs every
// minute; on_job_created handles the immediate path). Only the queue worker is
// wired here — the other scheduled functions in ./scheduled (log/idempotency
// cleanup, soft-delete purge, quota snapshots) are intentionally left
// un-deployed pending a deliberate decision, since some have destructive
// side effects.
export { process_job_queue } from "./scheduled/process_job_queue.scheduled";

// Plaid transient-error auto-retry: silently re-syncs items that are down /
// rate limited every 4h, surfacing a reconnect prompt only after 24h. Safe to
// deploy — reads + targeted item updates, no destructive side effects.
export {
  retry_transient_plaid_errors_scheduled,
} from "./scheduled/retry_transient_plaid_errors.scheduled";

// Plaid relink-attempt retention cleanup (daily; safe — deletes only records
// older than 30 days).
export {
  cleanup_relink_attempts_scheduled,
} from "./scheduled/cleanup_relink_attempts.scheduled";
