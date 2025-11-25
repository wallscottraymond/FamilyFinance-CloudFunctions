"use strict";
/**
 * Category-to-Transaction Matching Utility
 *
 * Provides in-memory utilities for enhancing transaction categories based on:
 * - Merchant name lookups in categories collection
 * - Transaction name keyword matching
 * - User-specific category rules
 * - Group-level category preferences
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchCategoriesToTransactions = matchCategoriesToTransactions;
exports.lookupCategoryByMerchant = lookupCategoryByMerchant;
exports.lookupCategoryByTransactionName = lookupCategoryByTransactionName;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
const types_1 = require("../../../types");
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
async function matchCategoriesToTransactions(transactions, userId) {
    console.log(`🔄 Enhancing categories for ${transactions.length} transactions (in-memory)`);
    let matchedCount = 0;
    try {
        // Process each transaction in the array
        for (const transaction of transactions) {
            try {
                // Only enhance if currently OTHER_EXPENSE or unassigned
                if (transaction.plaidPrimaryCategory !== types_1.TransactionCategory.OTHER_EXPENSE) {
                    console.log(`  ⏭️ Skipping transaction - already has category ${transaction.plaidPrimaryCategory}`);
                    continue;
                }
                // Extract merchant and transaction name from root-level fields
                const merchantName = transaction.merchantName;
                const transactionName = transaction.name;
                let newCategory = null;
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
                    transaction.updatedAt = firestore_1.Timestamp.now();
                    // Also update the category in all splits
                    transaction.splits = transaction.splits.map(split => (Object.assign(Object.assign({}, split), { plaidPrimaryCategory: newCategory, plaidDetailedCategory: newCategory, updatedAt: firestore_1.Timestamp.now() })));
                    matchedCount++;
                }
            }
            catch (error) {
                console.error(`Error matching category for transaction:`, error);
            }
        }
        console.log(`✅ Enhanced ${matchedCount} transaction categories out of ${transactions.length}`);
        return transactions; // Return modified array
    }
    catch (error) {
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
async function lookupCategoryByMerchant(merchantName) {
    try {
        console.log(`  🔍 Looking up merchant in categories collection: "${merchantName}"`);
        // Query categories collection for matching merchant
        const categoriesSnapshot = await index_1.db.collection('categories')
            .where('merchants', 'array-contains', merchantName.toLowerCase())
            .limit(1)
            .get();
        if (!categoriesSnapshot.empty) {
            const categoryDoc = categoriesSnapshot.docs[0];
            const categoryId = categoryDoc.id;
            return categoryId;
        }
        return null;
    }
    catch (error) {
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
async function lookupCategoryByTransactionName(transactionName) {
    try {
        console.log(`  🔍 Looking up transaction name in categories collection: "${transactionName}"`);
        // Query categories collection for matching keywords in transaction name
        const categoriesSnapshot = await index_1.db.collection('categories').get();
        for (const doc of categoriesSnapshot.docs) {
            const categoryData = doc.data();
            const keywords = categoryData.keywords || [];
            // Check if any keyword matches the transaction name
            const nameMatch = keywords.some((keyword) => transactionName.toLowerCase().includes(keyword.toLowerCase()));
            if (nameMatch) {
                const categoryId = doc.id;
                console.log(`  ✅ Found match via keywords in category: ${categoryId}`);
                return categoryId;
            }
        }
        return null;
    }
    catch (error) {
        console.error('Error looking up category by transaction name:', error);
        return null;
    }
}
//# sourceMappingURL=matchCategoriesToTransactions.js.map