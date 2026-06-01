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

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
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
export async function match_categories_to_transactions(
  transactions: FamilyTransaction[],
  user_id: string
): Promise<FamilyTransaction[]> {
  console.log(`🔄 Enhancing categories for ${transactions.length} transactions (in-memory)`);

  let matched_count = 0;

  try {
    // Process each transaction in the array
    for (const transaction of transactions) {
      try {
        // Only enhance if currently OTHER_EXPENSE or unassigned
        if (transaction.plaidPrimaryCategory !== TransactionCategory.OTHER_EXPENSE) {
          console.log(`  ⏭️ Skipping transaction - already has category ${transaction.plaidPrimaryCategory}`);
          continue;
        }

        // Extract merchant and transaction name from root-level fields
        const merchant_name = transaction.merchantName;
        const transaction_name = transaction.name;

        let new_category: TransactionCategory | null = null;

        // Try merchant name lookup
        if (merchant_name) {
          new_category = await lookup_category_by_merchant(merchant_name);
          if (new_category) {
            console.log(`  ✅ Matched via merchant "${merchant_name}" → ${new_category}`);
          }
        }

        // Try transaction name lookup if merchant didn't match
        if (!new_category && transaction_name) {
          new_category = await lookup_category_by_transaction_name(transaction_name);
          if (new_category) {
            console.log(`  ✅ Matched via name "${transaction_name}" → ${new_category}`);
          }
        }

        // Update transaction in memory if new category found
        if (new_category) {
          // Update the primary category at root level
          transaction.plaidPrimaryCategory = new_category;
          transaction.plaidDetailedCategory = new_category; // Also update detailed

          // Update timestamp
          transaction.updatedAt = Timestamp.now();

          // Also update the category in all splits
          transaction.splits = transaction.splits.map(split => ({
            ...split,
            plaidPrimaryCategory: new_category!,
            plaidDetailedCategory: new_category!,
            updatedAt: Timestamp.now()
          }));

          matched_count++;
        }
      } catch (error) {
        console.error(`Error matching category for transaction:`, error);
      }
    }

    console.log(`✅ Enhanced ${matched_count} transaction categories out of ${transactions.length}`);

    return transactions; // Return modified array

  } catch (error) {
    console.error('Error in match_categories_to_transactions:', error);
    return transactions; // Return original array on error
  }
}

/**
 * Look up category by merchant name in the categories collection
 *
 * @param merchant_name - Merchant name to search for
 * @returns Matching TransactionCategory or null if not found
 */
export async function lookup_category_by_merchant(merchant_name: string): Promise<TransactionCategory | null> {
  try {
    console.log(`  🔍 Looking up merchant in categories collection: "${merchant_name}"`);

    // Query categories collection for matching merchant
    const categories_snapshot = await db.collection('categories')
      .where('merchants', 'array-contains', merchant_name.toLowerCase())
      .limit(1)
      .get();

    if (!categories_snapshot.empty) {
      const category_doc = categories_snapshot.docs[0];
      const category_id = category_doc.id as TransactionCategory;
      return category_id;
    }

    return null;
  } catch (error) {
    console.error('Error looking up category by merchant:', error);
    return null;
  }
}

/**
 * Look up category by transaction name in the categories collection
 *
 * @param transaction_name - Transaction name/description to search for
 * @returns Matching TransactionCategory or null if not found
 */
export async function lookup_category_by_transaction_name(transaction_name: string): Promise<TransactionCategory | null> {
  try {
    console.log(`  🔍 Looking up transaction name in categories collection: "${transaction_name}"`);

    // Query categories collection for matching keywords in transaction name
    const categories_snapshot = await db.collection('categories').get();

    for (const doc of categories_snapshot.docs) {
      const category_data = doc.data();
      const keywords = category_data.keywords || [];

      // Check if any keyword matches the transaction name
      const name_match = keywords.some((keyword: string) =>
        transaction_name.toLowerCase().includes(keyword.toLowerCase())
      );

      if (name_match) {
        const category_id = doc.id as TransactionCategory;
        console.log(`  ✅ Found match via keywords in category: ${category_id}`);
        return category_id;
      }
    }

    return null;
  } catch (error) {
    console.error('Error looking up category by transaction name:', error);
    return null;
  }
}

// Legacy exports for backward compatibility during migration
export {
  match_categories_to_transactions as matchCategoriesToTransactions,
  lookup_category_by_merchant as lookupCategoryByMerchant,
  lookup_category_by_transaction_name as lookupCategoryByTransactionName
};
