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
