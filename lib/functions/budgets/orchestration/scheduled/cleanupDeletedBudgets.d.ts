/**
 * Scheduled function to permanently delete budgets past their grace period
 *
 * Runs daily at 3:00 AM UTC.
 * Finds all budgets where:
 * - flaggedForDeletion: true
 * - deletionScheduledAt < now
 *
 * Then permanently deletes:
 * - The budget document
 * - All associated budget_periods
 * - Removes from user_summaries
 */
export declare const cleanupDeletedBudgets: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=cleanupDeletedBudgets.d.ts.map