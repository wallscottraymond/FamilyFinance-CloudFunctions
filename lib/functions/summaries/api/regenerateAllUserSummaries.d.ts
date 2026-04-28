/**
 * Callable API: Regenerate All User Summaries
 *
 * Regenerates all user_summaries for the authenticated user.
 * This is useful when:
 * - Summary data is stale or missing fields
 * - After schema changes to summary types
 * - Debugging summary issues
 *
 * Request Parameters:
 * - periodType: string (optional) - Filter to specific period type (MONTHLY, WEEKLY, BI_MONTHLY)
 *
 * Returns:
 * - success: boolean
 * - totalProcessed: number
 * - created: number
 * - updated: number
 * - errors: number
 * - message: string
 */
export declare const regenerateAllUserSummaries: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    message: string;
    totalProcessed: number;
    created: number;
    updated: number;
    errors: number;
    errorDetails: string[];
    success: boolean;
}>, unknown>;
//# sourceMappingURL=regenerateAllUserSummaries.d.ts.map