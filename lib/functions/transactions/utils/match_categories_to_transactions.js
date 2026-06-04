"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.match_categories_to_transactions = match_categories_to_transactions;
exports.matchCategoriesToTransactions = match_categories_to_transactions;
exports.lookup_category_by_merchant = lookup_category_by_merchant;
exports.lookupCategoryByMerchant = lookup_category_by_merchant;
exports.lookup_category_by_transaction_name = lookup_category_by_transaction_name;
exports.lookupCategoryByTransactionName = lookup_category_by_transaction_name;
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
 * @param user_id - User ID
 * @returns Modified array of transactions with enhanced categories
 */
async function match_categories_to_transactions(transactions, user_id) {
    console.log(`🔄 Enhancing categories for ${transactions.length} transactions (in-memory)`);
    let matched_count = 0;
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
                const merchant_name = transaction.merchantName;
                const transaction_name = transaction.name;
                let new_category = null;
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
                    transaction.updatedAt = firestore_1.Timestamp.now();
                    // Also update the category in all splits
                    transaction.splits = transaction.splits.map(split => (Object.assign(Object.assign({}, split), { plaidPrimaryCategory: new_category, plaidDetailedCategory: new_category, updatedAt: firestore_1.Timestamp.now() })));
                    matched_count++;
                }
            }
            catch (error) {
                console.error(`Error matching category for transaction:`, error);
            }
        }
        console.log(`✅ Enhanced ${matched_count} transaction categories out of ${transactions.length}`);
        return transactions; // Return modified array
    }
    catch (error) {
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
async function lookup_category_by_merchant(merchant_name) {
    try {
        console.log(`  🔍 Looking up merchant in categories collection: "${merchant_name}"`);
        // Query categories collection for matching merchant
        const categories_snapshot = await index_1.db.collection('categories')
            .where('merchants', 'array-contains', merchant_name.toLowerCase())
            .limit(1)
            .get();
        if (!categories_snapshot.empty) {
            const category_doc = categories_snapshot.docs[0];
            const category_id = category_doc.id;
            return category_id;
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
 * @param transaction_name - Transaction name/description to search for
 * @returns Matching TransactionCategory or null if not found
 */
async function lookup_category_by_transaction_name(transaction_name) {
    try {
        console.log(`  🔍 Looking up transaction name in categories collection: "${transaction_name}"`);
        // Query categories collection for matching keywords in transaction name
        const categories_snapshot = await index_1.db.collection('categories').get();
        for (const doc of categories_snapshot.docs) {
            const category_data = doc.data();
            const keywords = category_data.keywords || [];
            // Check if any keyword matches the transaction name
            const name_match = keywords.some((keyword) => transaction_name.toLowerCase().includes(keyword.toLowerCase()));
            if (name_match) {
                const category_id = doc.id;
                console.log(`  ✅ Found match via keywords in category: ${category_id}`);
                return category_id;
            }
        }
        return null;
    }
    catch (error) {
        console.error('Error looking up category by transaction name:', error);
        return null;
    }
}
//# sourceMappingURL=match_categories_to_transactions.js.map