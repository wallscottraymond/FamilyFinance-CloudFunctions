/**
 * Job Queue Cleanup Scheduled Function
 *
 * Entry point for periodic cleanup of finished (`completed` + `failed`) docs in
 * the `_jobs` collection. Without this, every processed job is retained forever
 * (a `completed` job is never deleted by the processor), which is how the queue
 * grew to ~1.6M docs and drove Firestore storage/read cost up.
 *
 * `completed` jobs are removed after 24h; `failed` jobs are kept 7 days for
 * debugging. The purge drains in 500-doc batches up to a per-run cap, so it also
 * grinds down an existing backlog over successive runs.
 *
 * Schedule: every 30 minutes.
 *
 * @module entry/scheduled/cleanup_jobs
 */
/**
 * Scheduled cleanup of old finished job-queue docs.
 */
export declare const cleanup_jobs_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=cleanup_jobs.scheduled.d.ts.map