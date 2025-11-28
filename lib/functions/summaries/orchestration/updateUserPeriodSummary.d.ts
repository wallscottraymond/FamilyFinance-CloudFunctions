/**
 * Updates or creates a user period summary in Firestore
 *
 * This orchestration function:
 * 1. Calculates the complete user period summary
 * 2. Checks if a summary already exists
 * 3. Creates a new summary or updates the existing one
 * 4. Returns the summary document
 *
 * This function is called by:
 * - Firestore triggers when resource periods change
 * - API endpoints for manual recalculation
 * - On-demand when a user requests a period summary that doesn't exist
 *
 * @param userId - The user ID
 * @param periodType - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * @param sourcePeriodId - The source period ID (e.g., "2025-M11")
 * @param includeEntries - Whether to include detailed entries (default: true - always include for tile rendering)
 * @returns The summary document ID
 */
export declare function updateUserPeriodSummary(userId: string, periodType: string, sourcePeriodId: string, includeEntries?: boolean): Promise<string>;
//# sourceMappingURL=updateUserPeriodSummary.d.ts.map