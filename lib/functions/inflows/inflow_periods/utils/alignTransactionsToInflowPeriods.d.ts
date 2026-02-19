/**
 * Align Transactions to Inflow Periods
 *
 * Matches Plaid transaction IDs to the correct inflow_period documents.
 * This is the core transaction matching logic for the income tracking system.
 *
 * Key Features:
 * - Matches transactions to ALL THREE period types (monthly, weekly, bi-weekly)
 * - Determines which occurrence each transaction satisfies
 * - Updates occurrence arrays (occurrencePaidFlags, occurrenceTransactionIds, occurrenceAmounts)
 * - Recalculates period totals and status
 *
 * NOTE: Plaid inflow transaction amounts are NEGATIVE (money coming IN).
 * We convert and store all amounts as POSITIVE values.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { Inflow } from '../../../../types';
/**
 * Result of aligning transactions to periods
 */
export interface AlignmentResult {
    transactionsProcessed: number;
    transactionsMatched: number;
    periodsUpdated: number;
    errors: string[];
}
/**
 * Transaction data for matching
 */
export interface TransactionForMatching {
    id: string;
    transactionId?: string;
    amount: number;
    date: Date | Timestamp;
    description?: string;
    merchantName?: string;
}
/**
 * Align transactions to inflow periods
 *
 * This is the main function that matches inflow transactions to their
 * corresponding inflow periods. It handles:
 * - Fetching transactions by Plaid transaction IDs
 * - Finding matching periods for each transaction
 * - Matching transactions to specific occurrences
 * - Updating occurrence arrays
 * - Recalculating period totals
 *
 * @param db - Firestore database instance
 * @param inflowId - The inflow document ID
 * @param inflow - The inflow document data
 * @param createdPeriodIds - Array of period IDs that were created (optional filter)
 * @returns AlignmentResult with statistics
 *
 * @example
 * ```typescript
 * // After creating inflow periods
 * const result = await alignTransactionsToInflowPeriods(
 *   db,
 *   'inflow_123',
 *   inflowData,
 *   ['period_1', 'period_2', 'period_3']
 * );
 * // Result: { transactionsProcessed: 5, transactionsMatched: 4, periodsUpdated: 6, errors: [] }
 * ```
 */
export declare function alignTransactionsToInflowPeriods(db: FirebaseFirestore.Firestore, inflowId: string, inflow: Partial<Inflow>, createdPeriodIds?: string[]): Promise<AlignmentResult>;
/**
 * Update a single inflow period with a transaction match
 *
 * Simpler function for updating a single period when a transaction is manually assigned.
 *
 * @param db - Firestore database instance
 * @param periodId - The inflow period document ID
 * @param transaction - The transaction to match
 * @returns Success status and any error message
 */
export declare function matchTransactionToInflowPeriod(db: FirebaseFirestore.Firestore, periodId: string, transaction: TransactionForMatching): Promise<{
    success: boolean;
    error?: string;
}>;
export default alignTransactionsToInflowPeriods;
//# sourceMappingURL=alignTransactionsToInflowPeriods.d.ts.map