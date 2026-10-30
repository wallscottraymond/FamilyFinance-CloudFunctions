"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.match_transaction_to_budget = exports.match_categories_to_transactions = void 0;
exports.format_transactions = format_transactions;
exports.formatTransactions = format_transactions;
const firestore_1 = require("../../../utils/firestore");
const build_transaction_data_1 = require("./build_transaction_data");
/** Firestore `in` takes at most 30 values. */
const ACCOUNT_IN_LIMIT = 30;
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
async function format_transactions(added_transactions, item_id, user_id, group_id, currency) {
    console.log(`➕ Mapping ${added_transactions.length} Plaid transactions to FamilyTransaction structure`);
    // Failures THROW (P2-H2): the sync saves the Plaid cursor only when nothing failed, so a
    // shorter list here would drop those transactions for good. A throw keeps the cursor where it
    // was and the next sync re-delivers them.
    const account_ids = [...new Set(added_transactions.map((t) => t.account_id))];
    const account_map = new Map();
    for (let i = 0; i < account_ids.length; i += ACCOUNT_IN_LIMIT) {
        const account_query = await (0, firestore_1.queryDocuments)("accounts", {
            where: [
                { field: "accountId", operator: "in", value: account_ids.slice(i, i + ACCOUNT_IN_LIMIT) },
                { field: "userId", operator: "==", value: user_id },
            ],
        });
        account_query.forEach((account) => {
            const acct = account;
            account_map.set(acct.accountId, acct);
        });
    }
    const formatted_transactions = [];
    for (const plaid_transaction of added_transactions) {
        const account = account_map.get(plaid_transaction.account_id);
        if (!account) {
            throw new Error(`Account ${plaid_transaction.account_id} not found for transaction ${plaid_transaction.transaction_id}`);
        }
        // Build the transaction data using extracted utility (no DB calls)
        formatted_transactions.push(await (0, build_transaction_data_1.build_transaction_data)(plaid_transaction, account, user_id, group_id, currency, item_id));
    }
    console.log(`✅ Mapped ${formatted_transactions.length} of ${added_transactions.length} Plaid transactions to FamilyTransaction structure`);
    return formatted_transactions;
}
// Re-export utilities for backward compatibility
var match_categories_to_transactions_1 = require("./match_categories_to_transactions");
Object.defineProperty(exports, "match_categories_to_transactions", { enumerable: true, get: function () { return match_categories_to_transactions_1.match_categories_to_transactions; } });
var match_transaction_to_budget_1 = require("./match_transaction_to_budget");
Object.defineProperty(exports, "match_transaction_to_budget", { enumerable: true, get: function () { return match_transaction_to_budget_1.match_transaction_to_budget; } });
//# sourceMappingURL=format_transactions.js.map