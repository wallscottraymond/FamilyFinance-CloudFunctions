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
// minute; on_job_created handles the immediate path).
export { process_job_queue } from "./scheduled/process_job_queue.scheduled";

// Internal-bookkeeping retention cleanups (daily). SAFE — each deletes only
// records past a retention cutoff from an INTERNAL collection, never user data:
//   • idempotency records (expire after 24h)
//   • observability logs (minimal/debug/traces, per-tier retention)
//   • trigger-processing dedup records (expire after 7d)
// Decided deploy-worthy 2026-07-11 (Budget-CRUD migration #9). Still deliberately
// EXCLUDED: purge_soft_deleted (permanent deletion of USER data — dangerous under
// dev==prod) and snapshot_quota (quota system not in active use).
export { cleanup_idempotency_scheduled } from "./scheduled/cleanup_idempotency.scheduled";
export { cleanup_logs_scheduled } from "./scheduled/cleanup_logs.scheduled";
export { cleanup_trigger_processing_scheduled } from "./scheduled/cleanup_trigger_processing.scheduled";

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

// Plaid webhook fallback: every 6h, runs a transaction sync for every active
// item so data keeps flowing even if a Plaid webhook is missed or rejected.
// Safe to deploy — reads + Plaid transactions/sync + targeted item updates, no
// destructive side effects.
export {
  sync_all_transactions_scheduled,
} from "./scheduled/sync_all_transactions.scheduled";
