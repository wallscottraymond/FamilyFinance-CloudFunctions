/**
 * Transaction Formatting Utilities
 *
 * This module handles pure Plaid-to-Transaction data mapping.
 * It builds transaction structures with null values for fields that will be
 * populated by subsequent matching functions.
 *
 * Responsibilities:
 * - Fetching account information
 * - Mapping Plaid transactions to FamilyTransaction structure
 * - Building transaction arrays for batch processing (no DB writes)
 *
 * @module transactions/utils/format_transactions
 */
import { Transaction as PlaidTransaction } from 'plaid';
import { Transaction as FamilyTransaction } from '../../../types';
/**
 * Format transactions from Plaid sync data (pure mapping, no DB writes)
 *
 * Maps Plaid transactions to FamilyTransaction structure with null values
 * for fields that will be populated by subsequent matching functions.
 *
 * Flow:
 * 1. Fetch account information
 * 2. Map each Plaid transaction to FamilyTransaction structure
 * 3. Return array of transactions (no DB operations)
 *
 * @param added_transactions - Raw transactions from Plaid
 * @param item_id - Plaid item ID
 * @param user_id - User ID
 * @param group_id - Group ID (will be null for now)
 * @param currency - Currency code
 * @returns Array of formatted transactions ready for matching
 */
export declare function format_transactions(added_transactions: PlaidTransaction[], item_id: string, user_id: string, group_id: string | undefined, currency: string): Promise<FamilyTransaction[]>;
export { match_categories_to_transactions } from './match_categories_to_transactions';
export { match_transaction_to_budget } from './match_transaction_to_budget';
export { format_transactions as formatTransactions };
//# sourceMappingURL=format_transactions.d.ts.map