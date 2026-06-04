/**
 * Batch Transaction Creation Utility
 *
 * Handles atomic batch writing of transactions and outflow period updates to Firestore.
 * This is the final step in the transaction processing pipeline.
 *
 * @module transactions/utils/batch_create_transactions
 */
import { Transaction as FamilyTransaction } from '../../../types';
import { OutflowPeriodUpdate } from './match_transaction_splits_to_outflows';
/**
 * Batch create transactions and update outflow periods atomically
 *
 * Creates all transactions and applies outflow period updates in a single
 * batch operation for atomicity.
 *
 * @param transactions - Array of transactions to create
 * @param outflow_updates - Array of outflow period updates to apply
 * @returns Count of successfully created transactions
 */
export declare function batch_create_transactions(transactions: FamilyTransaction[], outflow_updates: OutflowPeriodUpdate[]): Promise<number>;
export { batch_create_transactions as batchCreateTransactions };
//# sourceMappingURL=batch_create_transactions.d.ts.map