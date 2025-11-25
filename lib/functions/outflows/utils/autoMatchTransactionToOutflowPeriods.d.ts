/**
 * Auto-Match Transaction Splits to Outflow Periods
 *
 * Automatically matches an outflow's historical transactions to appropriate outflow periods.
 * Called by onOutflowCreated trigger after periods are generated.
 *
 * Matching logic:
 * 1. Get all transactions referenced in outflow.transactionIds
 * 2. For each transaction, find the matching outflow period based on transaction date
 * 3. For each split in the transaction, assign it to the appropriate outflow period
 * 4. Determine payment type (regular, catch_up, advance, extra_principal)
 * 5. Update transaction split with outflow assignment
 * 6. Add TransactionSplitReference to outflow period
 * 7. Recalculate outflow period statuses
 */
import * as admin from 'firebase-admin';
import { RecurringOutflow } from '../../../types';
/**
 * Result of auto-matching operation
 */
export interface AutoMatchResult {
    transactionsProcessed: number;
    splitsAssigned: number;
    periodsUpdated: number;
    errors: string[];
}
/**
 * Automatically match outflow's historical transactions to outflow periods
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param createdPeriodIds - Array of outflow period IDs that were just created
 * @returns Result with counts of matches and any errors
 */
export declare function autoMatchTransactionToOutflowPeriods(db: admin.firestore.Firestore, outflowId: string, outflow: RecurringOutflow, createdPeriodIds: string[]): Promise<AutoMatchResult>;
/**
 * Recalculate status for all updated outflow periods
 */
export declare function recalculateOutflowPeriodStatuses(db: admin.firestore.Firestore, periodIds: string[]): Promise<number>;
/**
 * Orchestrate the complete auto-matching workflow
 *
 * This function coordinates:
 * 1. Auto-matching transactions to periods
 * 2. Recalculating period statuses
 * 3. Error handling and logging
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param periodIds - Array of created period IDs
 * @returns Summary of the auto-matching operation
 */
export declare function orchestrateAutoMatchingWorkflow(db: admin.firestore.Firestore, outflowId: string, outflow: RecurringOutflow, periodIds: string[]): Promise<{
    success: boolean;
    transactionsProcessed: number;
    splitsAssigned: number;
    periodsUpdated: number;
    statusesUpdated: number;
    errors: string[];
}>;
//# sourceMappingURL=autoMatchTransactionToOutflowPeriods.d.ts.map