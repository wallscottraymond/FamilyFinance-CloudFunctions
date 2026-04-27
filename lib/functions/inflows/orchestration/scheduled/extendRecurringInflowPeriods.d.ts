/**
 * Scheduled Inflow Period Maintenance
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of inflow periods for recurring income sources.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC (matches budget maintenance)
 * - Maintains 1-year rolling window for recurring inflows
 * - Creates inflow_periods for any missing source_periods
 * - Uses occurrence calculation for multi-payment tracking
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
/**
 * Scheduled function to extend recurring inflow periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
export declare const extendRecurringInflowPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=extendRecurringInflowPeriods.d.ts.map