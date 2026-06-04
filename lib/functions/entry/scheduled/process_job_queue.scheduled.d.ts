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
 * Runs every minute to check for pending jobs.
 * Claims jobs atomically to prevent duplicate processing.
 */
export declare const process_job_queue: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=process_job_queue.scheduled.d.ts.map