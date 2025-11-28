/**
 * Pre-creates user period summaries for all period types (weekly, bi-monthly, monthly)
 *
 * This function is called when a new user account is created to pre-populate
 * their period summaries. This ensures instant dashboard loads with minimal
 * Firestore reads on the frontend.
 *
 * Strategy:
 * 1. Query source_periods to find current periods for each type (isCurrent: true)
 * 2. Use the index field to find 12 periods before and 12 periods after
 * 3. Create summaries using the actual periodId values from the database
 *
 * Creates summaries for:
 * - 25 weekly summaries (12 before + current + 12 after)
 * - 25 bi-monthly summaries (12 before + current + 12 after)
 * - 25 monthly summaries (12 before + current + 12 after)
 * Total: 75 period summaries
 *
 * @param userId - The user ID
 * @returns Promise that resolves when all summaries are created
 */
export declare function preCreateUserPeriodSummaries(userId: string): Promise<void>;
//# sourceMappingURL=preCreateUserPeriodSummaries.d.ts.map