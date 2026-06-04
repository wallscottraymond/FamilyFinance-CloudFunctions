/**
 * Trigger Processing Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of old trigger processing records.
 * These records track which triggers have been processed to ensure idempotency.
 *
 * Records expire after 7 days.
 *
 * Schedule: Daily at 3:30 AM UTC
 *
 * @module entry/scheduled/cleanup_trigger_processing
 */
/**
 * Scheduled cleanup of old trigger processing records.
 */
export declare const cleanup_trigger_processing_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=cleanup_trigger_processing.scheduled.d.ts.map