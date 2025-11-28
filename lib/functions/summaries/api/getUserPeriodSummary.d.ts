import { UserPeriodSummary } from "../../../types/periodSummaries";
/**
 * API: Get User Period Summary
 *
 * Fetches a user's period summary for a specific period. If the summary
 * doesn't exist, it generates it on-demand.
 *
 * Request Parameters:
 * - periodType: string - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * - sourcePeriodId: string - The source period ID (e.g., "2025-M11")
 * - includeEntries: boolean (optional) - Whether to include detailed entries (default: false)
 *
 * Returns:
 * - UserPeriodSummary object
 *
 * Errors:
 * - unauthenticated: User is not authenticated
 * - invalid-argument: Missing or invalid parameters
 * - internal: Server error during summary generation
 */
export declare const getUserPeriodSummary: import("firebase-functions/v2/https").CallableFunction<any, Promise<UserPeriodSummary>>;
//# sourceMappingURL=getUserPeriodSummary.d.ts.map