/**
 * Quota Snapshot Scheduled Functions
 *
 * Entry points for quota monitoring:
 * - snapshot_quota_scheduled: Creates hourly quota snapshots
 * - cleanup_quota_scheduled: Cleans up old quota data daily
 *
 * @module entry/scheduled/snapshot_quota
 */
/**
 * Scheduled quota snapshot creation.
 * Runs every hour at :15 minutes.
 *
 * Creates a snapshot of current quota usage and checks for alerts.
 */
export declare const snapshot_quota_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
/**
 * Scheduled cleanup of old quota data.
 * Runs daily at 4:30 AM UTC.
 *
 * Cleans up quota tracking and snapshot data older than 30 days.
 */
export declare const cleanup_quota_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=snapshot_quota.scheduled.d.ts.map