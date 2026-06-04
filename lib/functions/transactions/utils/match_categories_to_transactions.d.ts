/**
 * Category-to-Transaction Matching Utility
 *
 * Provides in-memory utilities for enhancing transaction categories based on:
 * - Merchant name lookups in categories collection
 * - Transaction name keyword matching
 * - User-specific category rules
 * - Group-level category preferences
 *
 * @module transactions/utils/match_categories_to_transactions
 */
import { Transaction as FamilyTransaction, TransactionCategory } from '../../../types';
/**
 * Match categories to transactions based on additional business logic (in-memory)
 *
 * This function enhances transaction categories by looking up:
 * - Merchant name lookups in categories collection
 * - Transaction name keyword matching
 * - User-specific category rules
 * - Group-level category preferences
 *
 * Operates in-memory on the transaction array (no DB writes).
 *
 * @param transactions - Array of transactions to enhance
 * @param user_id - User ID
 * @returns Modified array of transactions with enhanced categories
 */
export declare function match_categories_to_transactions(transactions: FamilyTransaction[], user_id: string): Promise<FamilyTransaction[]>;
/**
 * Look up category by merchant name in the categories collection
 *
 * @param merchant_name - Merchant name to search for
 * @returns Matching TransactionCategory or null if not found
 */
export declare function lookup_category_by_merchant(merchant_name: string): Promise<TransactionCategory | null>;
/**
 * Look up category by transaction name in the categories collection
 *
 * @param transaction_name - Transaction name/description to search for
 * @returns Matching TransactionCategory or null if not found
 */
export declare function lookup_category_by_transaction_name(transaction_name: string): Promise<TransactionCategory | null>;
export { match_categories_to_transactions as matchCategoriesToTransactions, lookup_category_by_merchant as lookupCategoryByMerchant, lookup_category_by_transaction_name as lookupCategoryByTransactionName };
//# sourceMappingURL=match_categories_to_transactions.d.ts.map