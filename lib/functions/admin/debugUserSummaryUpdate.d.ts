/**
 * DEBUG FUNCTION: Trace why user_summaries aren't being updated
 *
 * This function manually traces through the exact same flow that the
 * onBudgetPeriodCreatedPeriodSummary trigger should follow, logging
 * every step to identify where it's breaking.
 *
 * Usage:
 * firebase functions:call debugUserSummaryUpdate --data '{
 *   "budgetPeriodId": "1f911cf1-9a88-41ed-968f-13d600198b6f_2026BM06B"
 * }'
 */
export declare const debugUserSummaryUpdate: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    diagnosis: string;
    results: any;
    error?: undefined;
} | {
    success: boolean;
    error: string;
    results: any;
    diagnosis?: undefined;
}>>;
//# sourceMappingURL=debugUserSummaryUpdate.d.ts.map