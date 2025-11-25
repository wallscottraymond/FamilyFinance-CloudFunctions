/**
 * Category-to-Transaction Matching Utility
 *
 * Provides in-memory utilities for enhancing transaction categories based on:
 * - Merchant name lookups in categories collection
 * - Transaction name keyword matching
 * - User-specific category rules
 * - Group-level category preferences
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
 * @param userId - User ID
 * @returns Modified array of transactions with enhanced categories
 */
export declare function matchCategoriesToTransactions(transactions: FamilyTransaction[], userId: string): Promise<FamilyTransaction[]>;
/**
 * Look up category by merchant name in the categories collection
 *
 * @param merchantName - Merchant name to search for
 * @returns Matching TransactionCategory or null if not found
 */
export declare function lookupCategoryByMerchant(merchantName: string): Promise<TransactionCategory | null>;
/**
 * Look up category by transaction name in the categories collection
 *
 * @param transactionName - Transaction name/description to search for
 * @returns Matching TransactionCategory or null if not found
 */
export declare function lookupCategoryByTransactionName(transactionName: string): Promise<TransactionCategory | null>;
//# sourceMappingURL=matchCategoriesToTransactions.d.ts.map