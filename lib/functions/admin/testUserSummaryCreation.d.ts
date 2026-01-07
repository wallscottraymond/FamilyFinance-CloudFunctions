/**
 * DEV/ADMIN: Test User Summary Creation
 *
 * Manually trigger user_summaries document creation for a specific period
 * to debug why the trigger isn't working.
 *
 * Usage:
 * firebase functions:call testUserSummaryCreation --data '{
 *   "userId": "6GQtnUstiVQkBwfdoKojCOY3DVzC",
 *   "periodType": "bi_monthly",
 *   "sourcePeriodId": "2026BM06B"
 * }'
 */
export declare const testUserSummaryCreation: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    summaryId: string;
    message: string;
}>>;
//# sourceMappingURL=testUserSummaryCreation.d.ts.map