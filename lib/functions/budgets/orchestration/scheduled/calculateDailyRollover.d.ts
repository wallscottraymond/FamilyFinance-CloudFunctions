/**
 * Scheduled Daily Rollover Calculation
 *
 * This Cloud Function runs daily to ensure rollover amounts are calculated
 * for budget periods that just became current. This catches periods that
 * became active without any spending activity triggering the recalculation.
 *
 * Runs daily at 3:00 AM UTC (after period extension at 2:00 AM)
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
/**
 * Scheduled function to calculate rollover for current periods
 * Runs daily at 3:00 AM UTC
 */
export declare const calculateDailyRollover: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=calculateDailyRollover.d.ts.map