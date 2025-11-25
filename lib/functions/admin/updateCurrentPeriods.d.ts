/**
 * Scheduled function that runs daily at midnight UTC to update the isCurrent flag
 * for source periods based on the current date.
 *
 * This function:
 * 1. Sets ALL periods to isCurrent: false first
 * 2. Finds and sets current periods to isCurrent: true for each type:
 *    - Current monthly period (contains today's date)
 *    - Current weekly period (contains today's date)
 *    - Current bi-monthly period (contains today's date)
 * 3. Uses batch writes for efficient operations
 * 4. Logs which periods were updated
 */
export declare const updateCurrentPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=updateCurrentPeriods.d.ts.map