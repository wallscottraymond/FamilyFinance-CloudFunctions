/**
 * Admin function to backfill user_summaries for all existing periods
 *
 * This function is used to generate user_summaries for periods that were
 * created before the summary triggers were deployed.
 *
 * Process:
 * 1. Query all unique (userId, periodType, sourcePeriodId) combinations from:
 *    - budget_periods
 *    - outflow_periods
 *    - inflow_periods
 * 2. For each unique combination, call updateUserPeriodSummary()
 * 3. Track progress and report results
 *
 * Usage:
 * POST /backfillUserSummaries
 * Authorization: Bearer <admin_token>
 *
 * Optional query parameters:
 * - dryRun=true: Only count periods, don't create summaries
 * - userId=<userId>: Only process periods for specific user
 */
export declare const backfillUserSummaries: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=backfillUserSummaries.d.ts.map