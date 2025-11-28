/**
 * API: Recalculate User Period Summary
 *
 * Forces a recalculation of a user's period summary. This is useful when:
 * - Data has changed and the user wants to see updated metrics immediately
 * - Debugging or testing summary calculations
 * - Manually triggering a refresh after data imports
 *
 * Request Parameters:
 * - periodType: string - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * - sourcePeriodId: string - The source period ID (e.g., "2025-M11")
 * - includeEntries: boolean (optional) - Whether to include detailed entries (default: false)
 *
 * Returns:
 * - success: boolean - Whether the recalculation was successful
 * - summaryId: string - The ID of the recalculated summary
 * - message: string - Success message
 *
 * Errors:
 * - unauthenticated: User is not authenticated
 * - invalid-argument: Missing or invalid parameters
 * - internal: Server error during summary recalculation
 */
export declare const recalculateUserPeriodSummary: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    summaryId: string;
    message: string;
}>>;
//# sourceMappingURL=recalculateUserPeriodSummary.d.ts.map