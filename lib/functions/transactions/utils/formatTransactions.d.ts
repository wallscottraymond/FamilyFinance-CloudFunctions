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
 * @param addedTransactions - Raw transactions from Plaid
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param groupId - Group ID (will be null for now)
 * @param currency - Currency code
 * @returns Array of formatted transactions ready for matching
 */
export declare function formatTransactions(addedTransactions: PlaidTransaction[], itemId: string, userId: string, groupId: string | undefined, currency: string): Promise<FamilyTransaction[]>;
export { matchCategoriesToTransactions } from './matchCategoriesToTransactions';
export { matchTransactionToBudget } from './matchTransactionToBudget';
//# sourceMappingURL=formatTransactions.d.ts.map