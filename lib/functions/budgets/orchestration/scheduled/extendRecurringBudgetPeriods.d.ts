/**
 * Scheduled Budget Period Maintenance (Simplified)
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of budget periods for recurring budgets. Simple and efficient.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC
 * - Maintains 1-year rolling window for recurring budgets
 * - Processes all period types (weekly, bi-monthly, monthly)
 * - Simplified logic with consistent behavior
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
/**
 * Scheduled function to extend recurring budget periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
export declare const extendRecurringBudgetPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=extendRecurringBudgetPeriods.d.ts.map