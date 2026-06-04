"use strict";
/**
 * Transaction-to-Budget Matching Utility
 *
 * Matches transactions to budgets based on date range.
 * Instead of matching to specific budget periods, matches to the parent budget ID.
 * This allows transactions to be tracked across all period types (weekly, monthly, etc.)
 * that share the same budget.
 *
 * @module transactions/utils/match_transaction_to_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.match_transaction_to_budget = match_transaction_to_budget;
exports.matchTransactionToBudget = matchTransactionToBudget;
const firestore_1 = require("firebase-admin/firestore");
const firestore_2 = require("../../../utils/firestore");
/**
 * Match a transaction to a budget based on its date and category
 *
 * @param user_id - User ID
 * @param transaction_date - Date of the transaction
 * @returns Budget match information (budget_id, budget_name)
 */
async function match_transaction_to_budget(user_id, transaction_date) {
    const transaction_timestamp = firestore_1.Timestamp.fromDate(transaction_date);
    console.log(`🔍 Looking for active budgets for user ${user_id}, transaction date: ${transaction_date.toISOString()}`);
    // Query all active budgets for the user
    const budgets_query = await (0, firestore_2.queryDocuments)('budgets', {
        where: [
            { field: 'createdBy', operator: '==', value: user_id },
            { field: 'isActive', operator: '==', value: true }
        ]
    });
    console.log(`📊 Found ${budgets_query.length} active budgets for user`);
    // Filter to find budget that contains the transaction date
    for (const budget of budgets_query) {
        const budget_data = budget;
        const budget_start = budget_data.startDate;
        const budget_end = budget_data.endDate;
        const is_ongoing = budget_data.isOngoing !== false; // Default to ongoing if not specified
        console.log(`  💰 Checking budget ${budget.id} (${budget_data.name}): start=${budget_start}, isOngoing=${is_ongoing}`);
        if (budget_start) {
            const start_timestamp = budget_start instanceof firestore_1.Timestamp
                ? budget_start
                : firestore_1.Timestamp.fromDate(new Date(budget_start));
            // Check if transaction is after budget start date
            const is_after_start = transaction_timestamp.toMillis() >= start_timestamp.toMillis();
            // For ongoing budgets, only check start date
            // For budgets with end dates, check both start and end
            let is_within_range = is_after_start;
            if (!is_ongoing && budget_end) {
                const end_timestamp = budget_end instanceof firestore_1.Timestamp
                    ? budget_end
                    : firestore_1.Timestamp.fromDate(new Date(budget_end));
                const is_before_end = transaction_timestamp.toMillis() <= end_timestamp.toMillis();
                is_within_range = is_after_start && is_before_end;
                console.log(`  ⏰ Budget range: ${start_timestamp.toDate().toISOString()} to ${end_timestamp.toDate().toISOString()}`);
            }
            else {
                console.log(`  ⏰ Budget start: ${start_timestamp.toDate().toISOString()} (ongoing)`);
            }
            console.log(`  🎯 Transaction timestamp: ${transaction_timestamp.toDate().toISOString()}`);
            console.log(`  ✔️ In range? ${is_within_range}`);
            if (is_within_range) {
                console.log(`  🎉 MATCH! Using budget ${budget.id} (${budget_data.name})`);
                return {
                    budget_id: budget.id,
                    budget_name: budget_data.name || 'General'
                };
            }
        }
    }
    console.log(`⚠️ No matching budget found for transaction dated ${transaction_date.toISOString()}`);
    return {
        budget_id: undefined,
        budget_name: 'General'
    };
}
// Legacy export wrapper for backward compatibility
async function matchTransactionToBudget(userId, transactionDate) {
    const result = await match_transaction_to_budget(userId, transactionDate);
    return {
        budgetId: result.budget_id,
        budgetName: result.budget_name
    };
}
//# sourceMappingURL=match_transaction_to_budget.js.map