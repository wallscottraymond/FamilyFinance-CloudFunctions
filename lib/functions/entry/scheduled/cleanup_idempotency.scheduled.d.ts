/**
 * Idempotency Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of expired idempotency records.
 * Records expire after 24 hours.
 *
 * Schedule: Daily at 3:00 AM UTC
 *
 * @module entry/scheduled/cleanup_idempotency
 */
/**
 * Scheduled cleanup of expired idempotency records.
 */
export declare const cleanup_idempotency_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=cleanup_idempotency.scheduled.d.ts.map