/**
 * =============================================================================
 * Find Matching Outflow Periods Utility
 * =============================================================================
 *
 * This utility module provides functions to locate all three outflow period types
 * (monthly, weekly, bi-weekly) that correspond to a specific transaction or time period.
 *
 * WHY THIS EXISTS:
 * ----------------
 * The Family Finance app displays bills in three different period views:
 * - Monthly View: Shows bills organized by calendar month
 * - Weekly View: Shows bills organized by week
 * - Bi-Weekly View: Shows bills organized by two-week periods
 *
 * When a user marks a transaction as a bill payment, we need to update ALL THREE
 * views simultaneously so that the payment status is consistent across all period types.
 *
 * CORE CONCEPT:
 * -------------
 * For any given transaction date, there are THREE overlapping outflow periods:
 * 1. The monthly period containing that date
 * 2. The weekly period containing that date
 * 3. The bi-weekly period containing that date
 *
 * This utility finds all three periods so we can update them atomically.
 *
 * USAGE SCENARIOS:
 * ----------------
 * 1. Manual Bill Payment Assignment:
 *    User marks a transaction as paying a specific bill → find all three periods
 *    containing the transaction date → assign payment to all three
 *
 * 2. Advance Payment Assignment:
 *    User pays multiple months rent in advance → find all three periods for each
 *    target month → assign separate splits to each month's periods
 *
 * 3. Auto-Matching Historical Transactions:
 *    System detects recurring bill pattern → finds all three periods for each
 *    historical transaction → automatically assigns payments
 *
 * 4. Period Status Queries:
 *    User views bills screen → query all three period types → display consistent
 *    payment status across all views
 *
 * KEY FUNCTIONS:
 * --------------
 * - findMatchingOutflowPeriods: Find periods based on transaction date
 * - findMatchingOutflowPeriodsBySourcePeriod: Find periods based on target period
 * - validatePeriodsFound: Ensure at least one period was found
 * - getAllPeriodIds: Extract all non-null period IDs from result
 *
 * FILE LOCATION:
 * --------------
 * src/functions/outflows/utils/findMatchingOutflowPeriods.ts
 *
 * This is a UTILITY function (reusable business logic) in the outflows module.
 */
import * as admin from 'firebase-admin';
/**
 * Result object returned when searching for matching outflow periods
 *
 * STRUCTURE:
 * ----------
 * This interface represents the result of searching for outflow periods across
 * all three period types (monthly, weekly, bi-weekly).
 *
 * FIELDS:
 * -------
 * - monthlyPeriodId: Document ID of the monthly outflow_period, or null if not found
 * - weeklyPeriodId: Document ID of the weekly outflow_period, or null if not found
 * - biWeeklyPeriodId: Document ID of the bi-weekly outflow_period, or null if not found
 * - foundCount: Total number of periods found (0-3)
 *
 * TYPICAL RESULTS:
 * ----------------
 * - Success: foundCount = 3 (all three period types found)
 * - Partial: foundCount = 1-2 (some periods missing, may need generation)
 * - Failure: foundCount = 0 (no periods found, should throw error)
 *
 * EXAMPLE:
 * --------
 * {
 *   monthlyPeriodId: "outflow_123_2025-M10",
 *   weeklyPeriodId: "outflow_123_2025-W40",
 *   biWeeklyPeriodId: "outflow_123_2025-BM20",
 *   foundCount: 3
 * }
 */
export interface MatchingOutflowPeriodsResult {
    monthlyPeriodId: string | null;
    weeklyPeriodId: string | null;
    biWeeklyPeriodId: string | null;
    foundCount: number;
}
/**
 * Find all three period types for a given outflow and transaction date
 *
 * WHAT THIS DOES:
 * ---------------
 * Given an outflow ID and a transaction date, this function queries Firestore to find
 * the THREE outflow periods (monthly, weekly, bi-weekly) that contain that date.
 *
 * HOW IT WORKS:
 * -------------
 * 1. Queries outflow_periods collection with three conditions:
 *    - outflowId matches the provided outflow
 *    - periodStartDate <= transactionDate (period starts before or on transaction date)
 *    - periodEndDate >= transactionDate (period ends on or after transaction date)
 *
 * 2. Iterates through results and separates by periodType:
 *    - PeriodType.MONTHLY → monthlyPeriodId
 *    - PeriodType.WEEKLY → weeklyPeriodId
 *    - PeriodType.BI_MONTHLY → biWeeklyPeriodId
 *
 * 3. Returns result object with all three IDs and count
 *
 * WHEN TO USE:
 * ------------
 * - User manually assigns a transaction to a bill (use transaction.date)
 * - System auto-matches historical transactions (use transaction.date)
 * - Need to find current periods for a specific date
 *
 * WHEN NOT TO USE:
 * ----------------
 * - For advance payments across multiple periods → use findMatchingOutflowPeriodsBySourcePeriod
 * - When you already have period IDs → no need to query again
 *
 * FIRESTORE QUERY:
 * ----------------
 * Collection: outflow_periods
 * Filters:
 *   - outflowId == {outflowId}
 *   - periodStartDate <= {transactionDate}
 *   - periodEndDate >= {transactionDate}
 *
 * This query requires a composite index on (outflowId, periodStartDate, periodEndDate).
 *
 * EXPECTED BEHAVIOR:
 * ------------------
 * - Normal case: Returns 3 periods (monthly, weekly, bi-weekly)
 * - Edge case: Returns 1-2 periods if some period types don't exist yet
 * - Error case: Returns 0 periods if no periods found (should trigger error upstream)
 *
 * EXAMPLE:
 * --------
 * const result = await findMatchingOutflowPeriods(
 *   db,
 *   "outflow_internet_123",
 *   Timestamp.fromDate(new Date("2025-10-15"))
 * );
 *
 * // Result:
 * {
 *   monthlyPeriodId: "outflow_internet_123_2025-M10",    // October 2025
 *   weeklyPeriodId: "outflow_internet_123_2025-W42",     // Week 42 of 2025
 *   biWeeklyPeriodId: "outflow_internet_123_2025-BM20",  // Bi-weekly period 20
 *   foundCount: 3
 * }
 *
 * @param db - Firestore instance (admin.firestore.Firestore)
 * @param outflowId - The outflow document ID (e.g., "outflow_internet_123")
 * @param transactionDate - The date of the transaction (Firestore Timestamp)
 * @returns MatchingOutflowPeriodsResult with all three period IDs (null if not found)
 */
export declare function findMatchingOutflowPeriods(db: admin.firestore.Firestore, outflowId: string, transactionDate: admin.firestore.Timestamp): Promise<MatchingOutflowPeriodsResult>;
/**
 * Validate that at least one period was found
 *
 * @param result - Result from findMatchingOutflowPeriods
 * @throws Error if no periods were found
 */
export declare function validatePeriodsFound(result: MatchingOutflowPeriodsResult): void;
/**
 * Get all non-null period IDs from result
 *
 * @param result - Result from findMatchingOutflowPeriods
 * @returns Array of period IDs (only non-null values)
 */
export declare function getAllPeriodIds(result: MatchingOutflowPeriodsResult): string[];
/**
 * Find matching outflow periods based on a target source period
 *
 * WHAT THIS DOES:
 * ---------------
 * Given an outflow ID and a target source period ID, this function finds all three
 * outflow period types (monthly, weekly, bi-weekly) that OVERLAP with the target
 * source period's date range.
 *
 * WHY THIS EXISTS:
 * ----------------
 * This function solves the "advance payment" problem. When a user pays multiple
 * periods in advance (e.g., 3 months rent with one transaction), they need to:
 * 1. Split the transaction into multiple parts
 * 2. Assign each part to a DIFFERENT target period (e.g., Oct, Nov, Dec)
 *
 * The transaction date doesn't help here because it's the same for all splits.
 * Instead, we use the target SOURCE PERIOD ID to find the correct outflow periods.
 *
 * HOW IT WORKS:
 * -------------
 * 1. Fetches the source_periods document to get its date range:
 *    - startDate: When the source period begins
 *    - endDate: When the source period ends
 *
 * 2. Queries outflow_periods where periods OVERLAP with source period:
 *    - periodStartDate <= source.endDate (period starts before source ends)
 *    - periodEndDate >= source.startDate (period ends after source starts)
 *
 * 3. Separates results by periodType and prefers exact matches:
 *    - If outflow_period.periodId === targetPeriodId → EXACT MATCH (best)
 *    - Otherwise, use first match for that period type
 *
 * 4. Returns all three period IDs (monthly, weekly, bi-weekly)
 *
 * OVERLAP LOGIC:
 * --------------
 * Two date ranges overlap if:
 *   Range1.start <= Range2.end AND Range1.end >= Range2.start
 *
 * Example:
 *   Source Period: Oct 1-31 (2025-M10)
 *   Outflow Period: Oct 1-31 (outflow_123_2025-M10)
 *   → OVERLAP: Oct 1 <= Oct 31 AND Oct 31 >= Oct 1 ✓
 *
 * EXACT MATCH PREFERENCE:
 * -----------------------
 * If an outflow period's periodId matches the targetPeriodId, we prefer it:
 *   - Source Period ID: "2025-M10" (October monthly)
 *   - Outflow Period: { periodId: "2025-M10", periodType: "MONTHLY" }
 *   → EXACT MATCH ✓ (both monthly AND same period)
 *
 * This ensures we assign to the correct month when dealing with advance payments.
 *
 * USE CASES:
 * ----------
 * 1. Paying 3 months rent in advance:
 *    - Split 1 → targetPeriodId: "2025-M10" → finds Oct periods
 *    - Split 2 → targetPeriodId: "2025-M11" → finds Nov periods
 *    - Split 3 → targetPeriodId: "2025-M12" → finds Dec periods
 *
 * 2. Quarterly bill payment:
 *    - User pays Q4 2025 insurance → targetPeriodId: "2025-Q4"
 *    - Finds all periods overlapping Q4 (Oct-Dec)
 *
 * FIRESTORE QUERIES:
 * ------------------
 * Query 1: Get source period
 *   Collection: source_periods
 *   Document: {targetPeriodId}
 *
 * Query 2: Find overlapping outflow periods
 *   Collection: outflow_periods
 *   Filters:
 *     - outflowId == {outflowId}
 *     - periodStartDate <= source.endDate
 *     - periodEndDate >= source.startDate
 *
 * EXAMPLE:
 * --------
 * // User pays October 2025 rent in advance on Sept 1, 2025
 * const result = await findMatchingOutflowPeriodsBySourcePeriod(
 *   db,
 *   "outflow_rent_456",
 *   "2025-M10"  // October 2025 monthly period
 * );
 *
 * // Result:
 * {
 *   monthlyPeriodId: "outflow_rent_456_2025-M10",    // October monthly (exact match!)
 *   weeklyPeriodId: "outflow_rent_456_2025-W40",     // Week 40 (overlaps Oct 1-7)
 *   biWeeklyPeriodId: "outflow_rent_456_2025-BM19",  // Bi-weekly 19 (overlaps Oct 1-14)
 *   foundCount: 3
 * }
 *
 * ERROR HANDLING:
 * ---------------
 * - Throws if targetPeriodId doesn't exist in source_periods
 * - Throws if source period missing startDate or endDate
 * - Returns foundCount: 0 if no overlapping outflow periods (should error upstream)
 *
 * @param db - Firestore instance (admin.firestore.Firestore)
 * @param outflowId - The outflow document ID (e.g., "outflow_rent_456")
 * @param targetPeriodId - The source period ID to match against (e.g., "2025-M10")
 * @returns MatchingOutflowPeriodsResult with all three period IDs (null if not found)
 */
export declare function findMatchingOutflowPeriodsBySourcePeriod(db: admin.firestore.Firestore, outflowId: string, targetPeriodId: string): Promise<MatchingOutflowPeriodsResult>;
//# sourceMappingURL=findMatchingOutflowPeriods.d.ts.map