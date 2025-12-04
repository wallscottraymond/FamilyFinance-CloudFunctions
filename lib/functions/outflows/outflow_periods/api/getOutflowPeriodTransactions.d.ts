/**
 * Get Outflow Period Transactions - Callable Function
 *
 * Retrieve all transactions and splits assigned to an outflow period.
 * Returns enriched data with full transaction details for display in the detail screen.
 *
 * Memory: 256MiB, Timeout: 30s
 */
import { TransactionSplitReference } from '../../../../types';
import * as admin from 'firebase-admin';
/**
 * Request to get transactions for an outflow period
 */
export interface GetOutflowPeriodTransactionsRequest {
    outflowPeriodId: string;
}
/**
 * Enriched transaction data with split details
 */
export interface OutflowPeriodTransaction {
    transaction: {
        id: string;
        amount: number;
        description: string;
        date: admin.firestore.Timestamp;
        merchantName?: string;
        category: string;
        pending: boolean;
        accountId?: string;
    };
    split: {
        id: string;
        amount: number;
        description?: string;
        categoryId: string;
    };
    splitReference: TransactionSplitReference;
}
/**
 * Response from getting outflow period transactions
 */
export interface GetOutflowPeriodTransactionsResponse {
    success: boolean;
    outflowPeriod: {
        id: string;
        outflowDescription: string;
        amountDue: number;
        status: string;
        isDuePeriod: boolean;
        dueDate?: admin.firestore.Timestamp;
    };
    transactions: OutflowPeriodTransaction[];
    summary: {
        totalPaid: number;
        totalRegular: number;
        totalCatchUp: number;
        totalAdvance: number;
        totalExtraPrincipal: number;
        transactionCount: number;
        splitCount: number;
    };
    message?: string;
}
/**
 * Callable function to get transactions assigned to an outflow period
 */
export declare const getOutflowPeriodTransactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<GetOutflowPeriodTransactionsResponse>>;
//# sourceMappingURL=getOutflowPeriodTransactions.d.ts.map