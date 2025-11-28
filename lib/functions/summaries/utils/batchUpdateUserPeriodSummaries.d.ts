/**
 * Batch update user period summaries for multiple periods
 *
 * This function is called when multiple periods are created at once (e.g., when
 * an outflow is created and generates 25 periods). Instead of triggering 25
 * individual summary updates, this batches them by unique period.
 *
 * @param userId - The user ID
 * @param periodIds - Array of source period IDs that need summary updates
 * @param periodType - The period type (e.g., "monthly")
 * @returns Count of summaries updated
 */
export declare function batchUpdateUserPeriodSummaries(userId: string, periodIds: string[], periodType: string): Promise<number>;
/**
 * Batch update user period summaries from outflow period documents
 *
 * Extracts period information from outflow_period documents and updates summaries.
 * Groups periods by period type to batch updates efficiently.
 *
 * @param userId - The user ID
 * @param outflowPeriodIds - Array of outflow_period document IDs
 * @returns Count of summaries updated
 */
export declare function batchUpdateUserPeriodSummariesFromOutflowPeriods(userId: string, outflowPeriodIds: string[]): Promise<number>;
//# sourceMappingURL=batchUpdateUserPeriodSummaries.d.ts.map