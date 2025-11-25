"use strict";
/**
 * Create Test Transactions - Admin Function
 *
 * Simulates a Plaid /transactions/sync response and runs the complete
 * transaction creation pipeline to test the production flow.
 *
 * This function:
 * 1. Simulates Plaid /transactions/sync response
 * 2. Runs the complete transaction pipeline (format → match → create)
 * 3. Returns statistics on transactions created/modified/removed
 *
 * Memory: 512MiB, Timeout: 120s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const formatTransactions_1 = require("../utils/formatTransactions");
const matchCategoriesToTransactions_1 = require("../utils/matchCategoriesToTransactions");
const matchTransactionSplitsToSourcePeriods_1 = require("../utils/matchTransactionSplitsToSourcePeriods");
const matchTransactionSplitsToBudgets_1 = require("../utils/matchTransactionSplitsToBudgets");
const matchTransactionSplitsToOutflows_1 = require("../utils/matchTransactionSplitsToOutflows");
const batchCreateTransactions_1 = require("../utils/batchCreateTransactions");
// Initialize Firebase Admin if not already initialized
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
/**
 * Simulated Plaid /transactions/sync response
 * This matches the exact structure returned by Plaid's API
 */
const SIMULATED_PLAID_RESPONSE = {
    accounts: [
        {
            account_id: "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
            balances: {
                available: 110.94,
                current: 110.94,
                iso_currency_code: "USD",
                limit: null,
                unofficial_currency_code: null
            },
            mask: "0000",
            name: "Plaid Checking",
            official_name: "Plaid Gold Standard 0% Interest Checking",
            subtype: "checking",
            type: "depository"
        }
    ],
    added: [
        {
            account_id: "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
            account_owner: null,
            amount: 72.1,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            check_number: null,
            counterparties: [
                {
                    name: "Walmart",
                    type: "merchant",
                    logo_url: "https://plaid-merchant-logos.plaid.com/walmart_1100.png",
                    website: "walmart.com",
                    entity_id: "O5W5j4dN9OR3E6ypQmjdkWZZRoXEzVMz2ByWM",
                    confidence_level: "VERY_HIGH"
                }
            ],
            date: "2023-09-24",
            datetime: "2023-09-24T11:01:01Z",
            authorized_date: "2023-09-22",
            authorized_datetime: "2023-09-22T10:34:50Z",
            location: {
                address: "13425 Community Rd",
                city: "Poway",
                region: "CA",
                postal_code: "92064",
                country: "US",
                lat: 32.959068,
                lon: -117.037666,
                store_number: "1700"
            },
            name: "PURCHASE WM SUPERCENTER #1700",
            merchant_name: "Walmart",
            merchant_entity_id: "O5W5j4dN9OR3E6ypQmjdkWZZRoXEzVMz2ByWM",
            logo_url: "https://plaid-merchant-logos.plaid.com/walmart_1100.png",
            website: "walmart.com",
            payment_meta: {
                by_order_of: null,
                payee: null,
                payer: null,
                payment_method: null,
                payment_processor: null,
                ppd_id: null,
                reason: null,
                reference_number: null
            },
            payment_channel: "in store",
            pending: false,
            pending_transaction_id: "no86Eox18VHMvaOVL7gPUM9ap3aR1LsAVZ5nc",
            personal_finance_category: {
                primary: "GENERAL_MERCHANDISE",
                detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
                confidence_level: "VERY_HIGH"
            },
            personal_finance_category_icon_url: "https://plaid-category-icons.plaid.com/PFC_GENERAL_MERCHANDISE.png",
            transaction_id: "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje",
            transaction_code: null,
            transaction_type: "place"
        }
    ],
    modified: [
        {
            account_id: "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
            account_owner: null,
            amount: 28.34,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            check_number: null,
            counterparties: [
                {
                    name: "DoorDash",
                    type: "marketplace",
                    logo_url: "https://plaid-counterparty-logos.plaid.com/doordash_1.png",
                    website: "doordash.com",
                    entity_id: "YNRJg5o2djJLv52nBA1Yn1KpL858egYVo4dpm",
                    confidence_level: "HIGH"
                },
                {
                    name: "Burger King",
                    type: "merchant",
                    logo_url: "https://plaid-merchant-logos.plaid.com/burger_king_155.png",
                    website: "burgerking.com",
                    entity_id: "mVrw538wamwdm22mK8jqpp7qd5br0eeV9o4a1",
                    confidence_level: "VERY_HIGH"
                }
            ],
            date: "2023-09-28",
            datetime: "2023-09-28T15:10:09Z",
            authorized_date: "2023-09-27",
            authorized_datetime: "2023-09-27T08:01:58Z",
            location: {
                address: null,
                city: null,
                region: null,
                postal_code: null,
                country: null,
                lat: null,
                lon: null,
                store_number: null
            },
            name: "Dd Doordash Burgerkin",
            merchant_name: "Burger King",
            merchant_entity_id: "mVrw538wamwdm22mK8jqpp7qd5br0eeV9o4a1",
            logo_url: "https://plaid-merchant-logos.plaid.com/burger_king_155.png",
            website: "burgerking.com",
            payment_meta: {
                by_order_of: null,
                payee: null,
                payer: null,
                payment_method: null,
                payment_processor: null,
                ppd_id: null,
                reason: null,
                reference_number: null
            },
            payment_channel: "online",
            pending: true,
            pending_transaction_id: null,
            personal_finance_category: {
                primary: "FOOD_AND_DRINK",
                detailed: "FOOD_AND_DRINK_FAST_FOOD",
                confidence_level: "VERY_HIGH"
            },
            personal_finance_category_icon_url: "https://plaid-category-icons.plaid.com/PFC_FOOD_AND_DRINK.png",
            transaction_id: "yhnUVvtcGGcCKU0bcz8PDQr5ZUxUXebUvbKC0",
            transaction_code: null,
            transaction_type: "digital"
        }
    ],
    removed: [
        {
            account_id: "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
            transaction_id: "CmdQTNgems8BT1B7ibkoUXVPyAeehT3Tmzk0l"
        }
    ],
    next_cursor: "tVUUL15lYQN5rBnfDIc1I8xudpGdIlw9nsgeXWvhOfkECvUeR663i3Dt1uf/94S8ASkitgLcIiOSqNwzzp+bh89kirazha5vuZHBb2ZA5NtCDkkV",
    has_more: false,
    request_id: "Wvhy9PZHQLV8njG",
    transactions_update_status: "HISTORICAL_UPDATE_COMPLETE"
};
exports.createTestTransactions = (0, https_1.onRequest)({
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (req, res) => {
    try {
        console.log('');
        console.log('💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳');
        console.log('💳 SIMULATING PLAID TRANSACTION SYNC');
        console.log('💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳💳');
        console.log('');
        // Get target user ID from query params or use default
        const targetUserId = req.query.userId || 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1';
        const testItemId = 'test_plaid_item_' + Date.now();
        const currency = 'USD';
        console.log('📋 Test Configuration:');
        console.log(`  - User ID: ${targetUserId}`);
        console.log(`  - Item ID: ${testItemId}`);
        console.log(`  - Currency: ${currency}`);
        console.log('');
        const result = {
            transactionsAdded: 0,
            transactionsModified: 0,
            transactionsRemoved: 0,
            errors: []
        };
        // === PROCESS ADDED TRANSACTIONS ===
        if (SIMULATED_PLAID_RESPONSE.added.length > 0) {
            console.log('💳 ═══════════════════════════════════════════════════════════');
            console.log('💳 PROCESSING ADDED TRANSACTIONS');
            console.log('💳 ═══════════════════════════════════════════════════════════');
            console.log('');
            try {
                console.log(`🔄 Processing ${SIMULATED_PLAID_RESPONSE.added.length} added transactions through 6-step pipeline`);
                // Step 1: Format transactions (Plaid → Internal structure)
                console.log('🔄 Step 1/6: Formatting transactions...');
                const transactions = await (0, formatTransactions_1.formatTransactions)(SIMULATED_PLAID_RESPONSE.added, testItemId, targetUserId, undefined, // groupId = null
                currency);
                console.log(`  ✅ Formatted ${transactions.length} transactions`);
                console.log('');
                // Step 2: Match categories
                console.log('🔄 Step 2/6: Matching categories...');
                const withCategories = await (0, matchCategoriesToTransactions_1.matchCategoriesToTransactions)(transactions, targetUserId);
                console.log(`  ✅ Matched categories for ${withCategories.length} transaction splits`);
                console.log('');
                // Step 3: Match source periods
                console.log('🔄 Step 3/6: Matching source periods...');
                const withPeriods = await (0, matchTransactionSplitsToSourcePeriods_1.matchTransactionSplitsToSourcePeriods)(withCategories);
                console.log(`  ✅ Matched ${withPeriods.length} transaction splits to source periods`);
                console.log('');
                // Step 4: Match budgets
                console.log('🔄 Step 4/6: Matching budgets...');
                const withBudgets = await (0, matchTransactionSplitsToBudgets_1.matchTransactionSplitsToBudgets)(withPeriods, targetUserId);
                console.log(`  ✅ Matched budget IDs for ${withBudgets.length} transaction splits`);
                console.log('');
                // Step 5: Match outflows
                console.log('🔄 Step 5/6: Matching outflows...');
                const { transactions: final, outflowUpdates } = await (0, matchTransactionSplitsToOutflows_1.matchTransactionSplitsToOutflows)(withBudgets, targetUserId);
                console.log(`  ✅ Matched outflow IDs for ${final.length} transaction splits`);
                console.log(`  ✅ Generated ${outflowUpdates.length} outflow updates`);
                console.log('');
                // Step 6: Batch create transactions
                console.log('🔄 Step 6/6: Batch creating transactions...');
                const count = await (0, batchCreateTransactions_1.batchCreateTransactions)(final, outflowUpdates);
                console.log(`  ✅ Created ${count} transactions in Firebase`);
                console.log('');
                result.transactionsAdded = count;
            }
            catch (error) {
                console.error('❌ Error processing added transactions:', error);
                result.errors.push(`Added transactions error: ${error.message}`);
            }
        }
        // === PROCESS MODIFIED TRANSACTIONS ===
        if (SIMULATED_PLAID_RESPONSE.modified.length > 0) {
            console.log('💳 ═══════════════════════════════════════════════════════════');
            console.log('💳 PROCESSING MODIFIED TRANSACTIONS');
            console.log('💳 ═══════════════════════════════════════════════════════════');
            console.log('');
            console.log(`⚠️  Note: Modified transactions would be updated in production`);
            console.log(`   Simulated: ${SIMULATED_PLAID_RESPONSE.modified.length} transactions`);
            console.log('');
            // In a real implementation, we would:
            // 1. Look up existing transactions by transaction_id
            // 2. Re-run the pipeline if material changes
            // 3. Update fields directly if minor changes
            result.transactionsModified = SIMULATED_PLAID_RESPONSE.modified.length;
        }
        // === PROCESS REMOVED TRANSACTIONS ===
        if (SIMULATED_PLAID_RESPONSE.removed.length > 0) {
            console.log('💳 ═══════════════════════════════════════════════════════════');
            console.log('💳 PROCESSING REMOVED TRANSACTIONS');
            console.log('💳 ═══════════════════════════════════════════════════════════');
            console.log('');
            console.log(`⚠️  Note: Removed transactions would be deleted in production`);
            console.log(`   Simulated: ${SIMULATED_PLAID_RESPONSE.removed.length} transactions`);
            console.log('');
            result.transactionsRemoved = SIMULATED_PLAID_RESPONSE.removed.length;
        }
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 TRANSACTION SYNC SIMULATION COMPLETE!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('📈 Final Results:');
        console.log(`  💳 Transactions Added: ${result.transactionsAdded}`);
        console.log(`  💳 Transactions Modified: ${result.transactionsModified} (simulated)`);
        console.log(`  💳 Transactions Removed: ${result.transactionsRemoved} (simulated)`);
        console.log(`  ⚠️  Errors: ${result.errors.length}`);
        console.log('');
        if (result.errors.length > 0) {
            console.log('❌ Errors encountered:');
            result.errors.forEach(err => console.log(`  - ${err}`));
            console.log('');
        }
        // Return detailed response
        res.status(200).json({
            success: result.errors.length === 0,
            message: `Simulated Plaid sync: ${result.transactionsAdded} added, ${result.transactionsModified} modified, ${result.transactionsRemoved} removed`,
            data: {
                targetUserId,
                testItemId,
                currency,
                transactionsAdded: result.transactionsAdded,
                transactionsModified: result.transactionsModified,
                transactionsRemoved: result.transactionsRemoved,
                errors: result.errors,
                simulatedResponse: {
                    accounts: SIMULATED_PLAID_RESPONSE.accounts.length,
                    added: SIMULATED_PLAID_RESPONSE.added.length,
                    modified: SIMULATED_PLAID_RESPONSE.modified.length,
                    removed: SIMULATED_PLAID_RESPONSE.removed.length
                }
            }
        });
    }
    catch (error) {
        console.error('');
        console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌');
        console.error('❌ FATAL ERROR in createTestTransactions');
        console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌');
        console.error(error);
        console.error('');
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
    }
});
//# sourceMappingURL=createTestTransactions.js.map