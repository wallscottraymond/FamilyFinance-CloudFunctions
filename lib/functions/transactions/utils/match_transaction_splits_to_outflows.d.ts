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
 *
 * @module transactions/utils/match_transaction_splits_to_outflows
 */
import { Timestamp } from 'firebase-admin/firestore';
import { Transaction as FamilyTransaction } from '../../../types';
/**
 * Result of outflow matching with both transactions and period updates
 */
export interface MatchOutflowsResult {
    transactions: FamilyTransaction[];
    outflow_updates: OutflowPeriodUpdate[];
}
/**
 * Outflow period update to be applied in batch
 */
export interface OutflowPeriodUpdate {
    period_id: string;
    transaction_split_ref: {
        transaction_id: string;
        split_id: string;
        amount: number;
        payment_date: Timestamp;
    };
}
/**
 * Match transaction splits to outflow periods (in-memory)
 *
 * Matches transactions to outflow periods and builds list of updates
 * to apply to outflow_periods collection in batch.
 *
 * @param transactions - Array of transactions to match
 * @param user_id - User ID for querying user-specific outflows
 * @returns Result with modified transactions and outflow period updates
 */
export declare function match_transaction_splits_to_outflows(transactions: FamilyTransaction[], user_id: string): Promise<MatchOutflowsResult>;
export interface LegacyMatchOutflowsResult {
    transactions: FamilyTransaction[];
    outflowUpdates: Array<{
        periodId: string;
        transactionSplitRef: {
            transactionId: string;
            splitId: string;
            amount: number;
            paymentDate: Timestamp;
        };
    }>;
}
/**
 * Legacy wrapper that converts snake_case output to camelCase for backward compatibility
 */
export declare function matchTransactionSplitsToOutflows(transactions: FamilyTransaction[], userId: string): Promise<LegacyMatchOutflowsResult>;
//# sourceMappingURL=match_transaction_splits_to_outflows.d.ts.map