/**
 * Log Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of old log entries.
 * - Tier 1 (minimal logs): 30 days retention
 * - Tier 2 (debug logs): 7 days retention
 * - Traces: 30 days retention
 *
 * Schedule: Daily at 4:00 AM UTC
 *
 * @module entry/scheduled/cleanup_logs
 */
/**
 * Scheduled cleanup of old log entries.
 */
export declare const cleanup_logs_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=cleanup_logs.scheduled.d.ts.map