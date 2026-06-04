/**
 * Update Transaction Splits - Callable Cloud Function
 *
 * Callable version of updateTransaction for mobile app usage.
 * Updates transaction splits with budget assignment and validation.
 *
 * Memory: 256MiB, Timeout: 30s
 */
import { Transaction, TransactionSplit } from "../../../../types";
interface UpdateTransactionSplitsRequest {
    transactionId: string;
    splits: TransactionSplit[];
    userNotes?: string;
    isHidden?: boolean;
    isRecurring?: boolean;
}
interface UpdateTransactionSplitsResponse {
    success: boolean;
    transaction?: Transaction;
    message?: string;
}
/**
 * Update transaction splits via callable function
 *
 * This function:
 * 1. Validates user authentication and ownership
 * 2. Validates and assigns splits to budgets
 * 3. Updates the transaction in Firestore
 * 4. Updates budget spending calculations
 */
export declare const updateTransactionSplits: import("firebase-functions/v2/https").CallableFunction<UpdateTransactionSplitsRequest, Promise<UpdateTransactionSplitsResponse>, unknown>;
export {};
//# sourceMappingURL=updateTransactionSplits.d.ts.map