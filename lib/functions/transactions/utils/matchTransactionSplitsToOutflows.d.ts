/**
 * Transaction Splits to Outflows Matching Utility (In-Memory Processing)
 *
 * Matches transaction splits to outflow periods based on:
 * - Merchant name matching
 * - Amount matching (within tolerance)
 * - Due date proximity
 *
 * Operates in-memory on transaction arrays (no DB writes).
 * Returns both modified transactions and outflow period updates for batching.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { Transaction as FamilyTransaction } from '../../../types';
/**
 * Result of outflow matching with both transactions and period updates
 */
export interface MatchOutflowsResult {
    transactions: FamilyTransaction[];
    outflowUpdates: OutflowPeriodUpdate[];
}
/**
 * Outflow period update to be applied in batch
 */
export interface OutflowPeriodUpdate {
    periodId: string;
    transactionSplitRef: {
        transactionId: string;
        splitId: string;
        amount: number;
        paymentDate: Timestamp;
    };
}
/**
 * Match transaction splits to outflow periods (in-memory)
 *
 * Matches transactions to outflow periods and builds list of updates
 * to apply to outflow_periods collection in batch.
 *
 * @param transactions - Array of transactions to match
 * @param userId - User ID for querying user-specific outflows
 * @returns Result with modified transactions and outflow period updates
 */
export declare function matchTransactionSplitsToOutflows(transactions: FamilyTransaction[], userId: string): Promise<MatchOutflowsResult>;
//# sourceMappingURL=matchTransactionSplitsToOutflows.d.ts.map