/**
 * Batch Transaction Creation Utility
 *
 * Handles atomic batch writing of transactions and outflow period updates to Firestore.
 * This is the final step in the transaction processing pipeline.
 */
import { Transaction as FamilyTransaction } from '../../../types';
import { OutflowPeriodUpdate } from './matchTransactionSplitsToOutflows';
/**
 * Batch create transactions and update outflow periods atomically
 *
 * Creates all transactions and applies outflow period updates in a single
 * batch operation for atomicity.
 *
 * @param transactions - Array of transactions to create
 * @param outflowUpdates - Array of outflow period updates to apply
 * @returns Count of successfully created transactions
 */
export declare function batchCreateTransactions(transactions: FamilyTransaction[], outflowUpdates: OutflowPeriodUpdate[]): Promise<number>;
//# sourceMappingURL=batchCreateTransactions.d.ts.map