/**
 * Soft-Deleted Records Purge Scheduled Function
 *
 * Entry point for weekly permanent deletion of soft-deleted records.
 * Records are soft-deleted first (isDeleted=true) to allow for recovery.
 * After 30 days, they are permanently purged.
 *
 * Schedule: Sundays at 5:00 AM UTC
 *
 * @module entry/scheduled/purge_soft_deleted
 */
/**
 * Scheduled purge of soft-deleted records.
 */
export declare const purge_soft_deleted_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=purge_soft_deleted.scheduled.d.ts.map