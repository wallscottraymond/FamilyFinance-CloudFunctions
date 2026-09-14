/**
 * Process Job Queue Scheduled Function
 *
 * Runs periodically to process pending jobs in the queue.
 * Handles cascade operations for account removal and other async work.
 *
 * @module entry/scheduled/process_job_queue
 */
/**
 * Scheduled function to process the job queue.
 *
 * Runs every 5 minutes as a BACKSTOP: `on_job_created` processes jobs in real
 * time the instant they're created, so this poll only sweeps up jobs whose
 * trigger failed/timed out or whose `scheduled_for` has come due, and reclaims
 * stuck `processing` jobs. Every-minute polling was ~5× the `_jobs` read cost for
 * a pure fallback ([[Firestore-Read-Cost-Reduction]] P2).
 * Claims jobs atomically to prevent duplicate processing.
 */
export declare const process_job_queue: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=process_job_queue.scheduled.d.ts.map