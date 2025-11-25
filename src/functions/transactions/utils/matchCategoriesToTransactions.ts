/**
 * Category-to-Transaction Matching Utility
 *
 * Provides in-memory utilities for enhancing transaction categories based on:
 * - Merchant name lookups in categories collection
 * - Transaction name keyword matching
 * - User-specific category rules
 * - Group-level category preferences
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
 * @param userId - User ID
 * @returns Modified array of transactions with enhanced categories
 */
export async function matchCategoriesToTransactions(
  transactions: FamilyTransaction[],
  userId: string
): Promise<FamilyTransaction[]> {
  console.log(`🔄 Enhancing categories for ${transactions.length} transactions (in-memory)`);

  let matchedCount = 0;

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
        const merchantName = transaction.merchantName;
        const transactionName = transaction.name;

        let newCategory: TransactionCategory | null = null;

        // Try merchant name lookup
        if (merchantName) {
          newCategory = await lookupCategoryByMerchant(merchantName);
          if (newCategory) {
            console.log(`  ✅ Matched via merchant "${merchantName}" → ${newCategory}`);
          }
        }

        // Try transaction name lookup if merchant didn't match
        if (!newCategory && transactionName) {
          newCategory = await lookupCategoryByTransactionName(transactionName);
          if (newCategory) {
            console.log(`  ✅ Matched via name "${transactionName}" → ${newCategory}`);
          }
        }

        // Update transaction in memory if new category found
        if (newCategory) {
          // Update the primary category at root level
          transaction.plaidPrimaryCategory = newCategory;
          transaction.plaidDetailedCategory = newCategory; // Also update detailed

          // Update timestamp
          transaction.updatedAt = Timestamp.now();

          // Also update the category in all splits
          transaction.splits = transaction.splits.map(split => ({
            ...split,
            plaidPrimaryCategory: newCategory!,
            plaidDetailedCategory: newCategory!,
            updatedAt: Timestamp.now()
          }));

          matchedCount++;
        }
      } catch (error) {
        console.error(`Error matching category for transaction:`, error);
      }
    }

    console.log(`✅ Enhanced ${matchedCount} transaction categories out of ${transactions.length}`);

    return transactions; // Return modified array

  } catch (error) {
    console.error('Error in matchCategoriesToTransactions:', error);
    return transactions; // Return original array on error
  }
}

/**
 * Look up category by merchant name in the categories collection
 *
 * @param merchantName - Merchant name to search for
 * @returns Matching TransactionCategory or null if not found
 */
export async function lookupCategoryByMerchant(merchantName: string): Promise<TransactionCategory | null> {
  try {
    console.log(`  🔍 Looking up merchant in categories collection: "${merchantName}"`);

    // Query categories collection for matching merchant
    const categoriesSnapshot = await db.collection('categories')
      .where('merchants', 'array-contains', merchantName.toLowerCase())
      .limit(1)
      .get();

    if (!categoriesSnapshot.empty) {
      const categoryDoc = categoriesSnapshot.docs[0];
      const categoryId = categoryDoc.id as TransactionCategory;
      return categoryId;
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
 * @param transactionName - Transaction name/description to search for
 * @returns Matching TransactionCategory or null if not found
 */
export async function lookupCategoryByTransactionName(transactionName: string): Promise<TransactionCategory | null> {
  try {
    console.log(`  🔍 Looking up transaction name in categories collection: "${transactionName}"`);

    // Query categories collection for matching keywords in transaction name
    const categoriesSnapshot = await db.collection('categories').get();

    for (const doc of categoriesSnapshot.docs) {
      const categoryData = doc.data();
      const keywords = categoryData.keywords || [];

      // Check if any keyword matches the transaction name
      const nameMatch = keywords.some((keyword: string) =>
        transactionName.toLowerCase().includes(keyword.toLowerCase())
      );

      if (nameMatch) {
        const categoryId = doc.id as TransactionCategory;
        console.log(`  ✅ Found match via keywords in category: ${categoryId}`);
        return categoryId;
      }
    }

    return null;
  } catch (error) {
    console.error('Error looking up category by transaction name:', error);
    return null;
  }
}
