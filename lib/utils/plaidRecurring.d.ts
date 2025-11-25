/**
 * Plaid Recurring Transactions Utilities
 *
 * Handles recurring transaction streams (income and expense patterns)
 */
import { PlaidApi } from 'plaid';
export interface RecurringProcessingResult {
    totalStreams: number;
    inflowStreams: number;
    outflowStreams: number;
    accountsProcessed: number;
    errors: number;
}
/**
 * Fetches and processes recurring transactions from Plaid
 */
export declare function processRecurringTransactions(plaidClient: PlaidApi, accessToken: string, accountIds: string[], userId: string): Promise<RecurringProcessingResult>;
//# sourceMappingURL=plaidRecurring.d.ts.map