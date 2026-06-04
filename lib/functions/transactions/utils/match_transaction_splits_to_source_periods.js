"use strict";
/**
 * Transaction Splits to Source Period Matching Utility (Batch In-Memory Processing)
 *
 * Maps transaction splits to source period IDs (monthly, weekly, bi-weekly).
 * Updates the monthlyPeriodId, weeklyPeriodId, and biWeeklyPeriodId fields
 * in each transaction split.
 *
 * This version operates in-memory on transaction arrays with batch period queries.
 *
 * @module transactions/utils/match_transaction_splits_to_source_periods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.match_transaction_splits_to_source_periods = match_transaction_splits_to_source_periods;
exports.matchTransactionSplitsToSourcePeriods = match_transaction_splits_to_source_periods;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
/**
 * Match transaction splits to source periods (batch in-memory processing)
 *
 * IMPORTANT: This function MUST be called for every transaction to map source period IDs.
 * It is independent of budget and outflow matching.
 *
 * SOURCE PERIODS ARE APP-WIDE (not user-specific). The function queries all source_periods
 * and matches them based on transaction dates only.
 *
 * Queries all source periods in one batch operation,
 * then updates EVERY split in EVERY transaction with period IDs in the fields:
 * - monthlyPeriodId
 * - weeklyPeriodId
 * - biWeeklyPeriodId
 *
 * @param transactions - Array of transactions to match
 * @returns Modified array of transactions with period IDs populated in ALL splits
 */
async function match_transaction_splits_to_source_periods(transactions) {
    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] === STARTING PERIOD MATCHING ===`);
    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Processing ${transactions.length} transactions`);
    if (transactions.length === 0) {
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] No transactions to process, returning empty array`);
        return transactions;
    }
    try {
        // Get all unique transaction dates
        const unique_dates = new Set();
        transactions.forEach(txn => {
            unique_dates.add(txn.transactionDate.toMillis());
        });
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Found ${unique_dates.size} unique transaction dates`);
        // Query ALL source periods (they are app-wide, not user-specific)
        // We'll filter in memory based on transaction dates
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Querying ALL source_periods collection...`);
        const periods_snapshot = await index_1.db.collection('source_periods')
            .get();
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] ✅ FOUND ${periods_snapshot.size} SOURCE PERIODS (app-wide)`);
        if (periods_snapshot.size === 0) {
            console.error(`❌❌❌ [match_transaction_splits_to_source_periods] NO SOURCE PERIODS FOUND! Cannot match transactions to periods. Please run generateSourcePeriods.`);
            return transactions;
        }
        // Build a period lookup map
        const periods = periods_snapshot.docs.map(doc => ({
            id: doc.id,
            type: doc.data().type,
            start_date: doc.data().startDate.toMillis(),
            end_date: doc.data().endDate.toMillis()
        }));
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Period types found: ${periods.slice(0, 5).map(p => p.type).join(', ')}`);
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Sample period date ranges: ${periods.slice(0, 3).map(p => `${p.type}: ${new Date(p.start_date).toISOString()} to ${new Date(p.end_date).toISOString()}`).join(' | ')}`);
        // Process each transaction
        let matched_count = 0;
        transactions.forEach(transaction => {
            const txn_date = transaction.transactionDate.toMillis();
            console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Processing transaction with date: ${new Date(txn_date).toISOString()} (${txn_date})`);
            // Find matching periods for this transaction date
            // Transaction date must be >= periodStartDate AND <= periodEndDate
            const matching_periods = periods.filter(period => txn_date >= period.start_date && txn_date <= period.end_date);
            if (matching_periods.length > 0) {
                console.log(`  ✅✅✅ Transaction date ${new Date(txn_date).toISOString()} matched ${matching_periods.length} periods: ${matching_periods.map(p => `${p.type}(${p.id})`).join(', ')}`);
            }
            else {
                console.log(`  ❌❌❌ Transaction date ${new Date(txn_date).toISOString()} matched NO periods`);
            }
            // Extract period IDs by type
            const monthly_period = matching_periods.find(p => p.type === 'monthly');
            const weekly_period = matching_periods.find(p => p.type === 'weekly');
            const bi_weekly_period = matching_periods.find(p => p.type === 'bi_monthly'); // Fixed: was 'bi_weekly', should be 'bi_monthly'
            // Update all splits in the transaction with period IDs
            const updated_splits = transaction.splits.map(split => (Object.assign(Object.assign({}, split), { monthlyPeriodId: (monthly_period === null || monthly_period === void 0 ? void 0 : monthly_period.id) || null, weeklyPeriodId: (weekly_period === null || weekly_period === void 0 ? void 0 : weekly_period.id) || null, biWeeklyPeriodId: (bi_weekly_period === null || bi_weekly_period === void 0 ? void 0 : bi_weekly_period.id) || null, updatedAt: firestore_1.Timestamp.now() })));
            console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Updated ${transaction.splits.length} splits with periods: monthly=${monthly_period === null || monthly_period === void 0 ? void 0 : monthly_period.id}, weekly=${weekly_period === null || weekly_period === void 0 ? void 0 : weekly_period.id}, biWeekly=${bi_weekly_period === null || bi_weekly_period === void 0 ? void 0 : bi_weekly_period.id}`);
            transaction.splits = updated_splits;
            if (matching_periods.length > 0) {
                matched_count++;
            }
        });
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] === PERIOD MATCHING COMPLETE ===`);
        console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] ✅ Successfully matched ${matched_count} of ${transactions.length} transactions to source periods`);
        return transactions;
    }
    catch (error) {
        console.error('[match_transaction_splits_to_source_periods] Error matching transaction splits to source periods:', error);
        return transactions; // Return original array on error
    }
}
//# sourceMappingURL=match_transaction_splits_to_source_periods.js.map