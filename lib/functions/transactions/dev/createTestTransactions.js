"use strict";
/**
 * Create Test Transactions - Development Function
 *
 * Seeds test transaction data into the local Firestore emulator by simulating
 * a Plaid /transactions/sync response and running it through the complete
 * production transaction pipeline.
 *
 * This function:
 * 1. Uses static Plaid test data (no actual Plaid API calls)
 * 2. Runs the complete 6-step transaction pipeline:
 *    - Format: Plaid → Internal structure
 *    - Match Categories: Category assignment
 *    - Match Source Periods: Period ID mapping (monthly/weekly/biweekly)
 *    - Match Budgets: Budget assignment
 *    - Match Outflows: Bill payment matching
 *    - Batch Create: Atomic Firestore write
 * 3. Creates real transactions in Firestore for testing
 *
 * Usage (Firebase Callable Function):
 *   Called from mobile app Dev Tools: "Create Test Transactions" button
 *
 * Memory: 512MiB, Timeout: 120s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const index_1 = require("../../../index");
const formatTransactions_1 = require("../utils/formatTransactions");
const matchCategoriesToTransactions_1 = require("../utils/matchCategoriesToTransactions");
const matchTransactionSplitsToSourcePeriods_1 = require("../utils/matchTransactionSplitsToSourcePeriods");
const matchTransactionSplitsToOutflows_1 = require("../utils/matchTransactionSplitsToOutflows");
const batchCreateTransactions_1 = require("../utils/batchCreateTransactions");
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
        // ConEd Bill Payment (matches outflow transaction ID)
        {
            account_id: "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
            account_owner: null,
            amount: 100,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            check_number: null,
            counterparties: [
                {
                    name: "ConEd",
                    type: "merchant",
                    logo_url: null,
                    website: "coned.com",
                    entity_id: "coned_entity_123",
                    confidence_level: "VERY_HIGH"
                }
            ],
            date: "2025-11-02",
            datetime: "2025-11-02T09:00:00Z",
            authorized_date: "2025-11-01",
            authorized_datetime: "2025-11-01T09:00:00Z",
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
            name: "ConEd Bill Payment",
            merchant_name: "ConEd",
            merchant_entity_id: "coned_entity_123",
            logo_url: null,
            website: "coned.com",
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
            pending: false,
            pending_transaction_id: null,
            personal_finance_category: {
                primary: "RENT_AND_UTILITIES",
                detailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
                confidence_level: "VERY_HIGH"
            },
            personal_finance_category_icon_url: "https://plaid-category-icons.plaid.com/PFC_UTILITIES.png",
            transaction_id: "txn_coned_004",
            transaction_code: null,
            transaction_type: "special"
        },
        // Costco Membership (matches outflow transaction ID)
        {
            account_id: "BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp",
            account_owner: null,
            amount: 120,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
            check_number: null,
            counterparties: [
                {
                    name: "Costco",
                    type: "merchant",
                    logo_url: "https://plaid-merchant-logos.plaid.com/costco_1.png",
                    website: "costco.com",
                    entity_id: "costco_entity_456",
                    confidence_level: "VERY_HIGH"
                }
            ],
            date: "2025-11-10",
            datetime: "2025-11-10T14:30:00Z",
            authorized_date: "2025-11-10",
            authorized_datetime: "2025-11-10T14:30:00Z",
            location: {
                address: "123 Warehouse Blvd",
                city: "San Diego",
                region: "CA",
                postal_code: "92101",
                country: "US",
                lat: 32.715736,
                lon: -117.161087,
                store_number: "1234"
            },
            name: "Costco Annual Membership",
            merchant_name: "Costco",
            merchant_entity_id: "costco_entity_456",
            logo_url: "https://plaid-merchant-logos.plaid.com/costco_1.png",
            website: "costco.com",
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
            pending_transaction_id: null,
            personal_finance_category: {
                primary: "GENERAL_MERCHANDISE",
                detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
                confidence_level: "VERY_HIGH"
            },
            personal_finance_category_icon_url: "https://plaid-category-icons.plaid.com/PFC_GENERAL_MERCHANDISE.png",
            transaction_id: "txn_costco_002",
            transaction_code: null,
            transaction_type: "place"
        },
        // Regular grocery transaction (no outflow match)
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
            date: "2025-11-14",
            datetime: "2025-11-14T11:01:01Z",
            authorized_date: "2025-11-12",
            authorized_datetime: "2025-11-12T10:34:50Z",
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
            transaction_id: "txn_walmart_001",
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
            date: "2025-11-15",
            datetime: "2025-11-15T15:10:09Z",
            authorized_date: "2025-11-14",
            authorized_datetime: "2025-11-14T08:01:58Z",
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
/**
 * Firebase Callable Function to create test transactions in local Firestore
 */
exports.createTestTransactions = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g;
    // Verify user is authenticated
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated to create test transactions');
    }
    try {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🧪 DEV: Creating Test Transactions');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        // Get authenticated user ID
        const targetUserId = request.auth.uid;
        console.log(`👤 Authenticated user: ${targetUserId}`);
        // Verify user exists in Firestore
        console.log(`🔍 Verifying user exists: ${targetUserId}`);
        const userDoc = await index_1.db.collection('users').doc(targetUserId).get();
        if (!userDoc.exists) {
            console.error(`❌ User not found: ${targetUserId}`);
            throw new https_1.HttpsError('not-found', `User not found: ${targetUserId}`, 'Make sure the user exists in your Firestore database');
        }
        console.log(`✅ User verified: ${((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.email) || 'No email'}`);
        console.log('');
        // Test configuration
        const testItemId = 'test_plaid_item_' + Date.now();
        const testAccountId = SIMULATED_PLAID_RESPONSE.accounts[0].account_id;
        const currency = 'USD';
        console.log('📋 Test Configuration:');
        console.log(`  - User ID: ${targetUserId}`);
        console.log(`  - Item ID: ${testItemId}`);
        console.log(`  - Account ID: ${testAccountId}`);
        console.log(`  - Currency: ${currency}`);
        console.log(`  - Transactions to add: ${SIMULATED_PLAID_RESPONSE.added.length}`);
        console.log('');
        // === CREATE TEST ACCOUNT ===
        console.log('🏦 Creating test account in Firestore...');
        const testAccount = {
            accountId: testAccountId,
            plaidAccountId: testAccountId,
            userId: targetUserId,
            itemId: testItemId,
            institutionId: 'ins_test',
            institutionName: 'Test Bank',
            accountName: SIMULATED_PLAID_RESPONSE.accounts[0].name,
            accountType: SIMULATED_PLAID_RESPONSE.accounts[0].type,
            accountSubtype: SIMULATED_PLAID_RESPONSE.accounts[0].subtype,
            mask: SIMULATED_PLAID_RESPONSE.accounts[0].mask,
            officialName: SIMULATED_PLAID_RESPONSE.accounts[0].official_name,
            currentBalance: SIMULATED_PLAID_RESPONSE.accounts[0].balances.current,
            availableBalance: SIMULATED_PLAID_RESPONSE.accounts[0].balances.available,
            limit: SIMULATED_PLAID_RESPONSE.accounts[0].balances.limit,
            isoCurrencyCode: SIMULATED_PLAID_RESPONSE.accounts[0].balances.iso_currency_code,
            isActive: true,
            isSyncEnabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastBalanceUpdate: new Date()
        };
        await index_1.db.collection('accounts').doc(testAccountId).set(testAccount);
        console.log(`✅ Test account created: ${testAccountId}`);
        console.log('');
        const result = {
            transactionsAdded: 0,
            transactionsModified: 0,
            transactionsRemoved: 0,
            createdTransactionIds: [],
            errors: []
        };
        // === PROCESS ADDED TRANSACTIONS ===
        if (SIMULATED_PLAID_RESPONSE.added.length > 0) {
            console.log('═══════════════════════════════════════════════════════════');
            console.log('💳 PROCESSING ADDED TRANSACTIONS (6-Step Pipeline)');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('');
            try {
                console.log(`🔄 Processing ${SIMULATED_PLAID_RESPONSE.added.length} added transactions`);
                console.log('');
                // Step 1: Format transactions (Plaid → Internal structure)
                console.log('⚙️  Step 1/6: Formatting transactions...');
                const transactions = await (0, formatTransactions_1.formatTransactions)(SIMULATED_PLAID_RESPONSE.added, testItemId, targetUserId, undefined, // groupId = null
                currency);
                console.log(`   ✅ Formatted ${transactions.length} transactions`);
                console.log(`   📊 First transaction: ${((_b = transactions[0]) === null || _b === void 0 ? void 0 : _b.description) || 'N/A'}`);
                console.log('');
                // Step 2: Match categories
                console.log('⚙️  Step 2/6: Matching categories...');
                const withCategories = await (0, matchCategoriesToTransactions_1.matchCategoriesToTransactions)(transactions, targetUserId);
                console.log(`   ✅ Matched categories for ${withCategories.length} transaction splits`);
                if ((_d = (_c = withCategories[0]) === null || _c === void 0 ? void 0 : _c.splits) === null || _d === void 0 ? void 0 : _d[0]) {
                    console.log(`   📊 First split category: ${withCategories[0].splits[0].internalPrimaryCategory || 'No category'}`);
                }
                console.log('');
                // Step 3: Match source periods
                console.log('⚙️  Step 3/6: Matching source periods...');
                const withPeriods = await (0, matchTransactionSplitsToSourcePeriods_1.matchTransactionSplitsToSourcePeriods)(withCategories);
                console.log(`   ✅ Matched ${withPeriods.length} transaction splits to source periods`);
                if ((_f = (_e = withPeriods[0]) === null || _e === void 0 ? void 0 : _e.splits) === null || _f === void 0 ? void 0 : _f[0]) {
                    console.log(`   📊 First split periods:`, {
                        monthly: withPeriods[0].splits[0].monthlyPeriodId || 'null',
                        weekly: withPeriods[0].splits[0].weeklyPeriodId || 'null',
                        biWeekly: withPeriods[0].splits[0].biWeeklyPeriodId || 'null',
                    });
                }
                console.log('');
                // Step 4: (budget matching removed 2026-07-27) — the Transaction Assignment
                // Engine assigns budgets via on_transaction_written after these docs are
                // written, so seeded test data is homed by the SAME single authority as
                // production. Splits are written unassigned; the engine assigns them.
                // Step 5: Match outflows
                console.log('⚙️  Step 5/6: Matching outflows...');
                const { transactions: final, outflowUpdates } = await (0, matchTransactionSplitsToOutflows_1.matchTransactionSplitsToOutflows)(withPeriods, targetUserId);
                console.log(`   ✅ Matched outflow IDs for ${final.length} transaction splits`);
                console.log(`   ✅ Generated ${outflowUpdates.length} outflow updates`);
                console.log('');
                // Step 6: Batch create transactions
                console.log('⚙️  Step 6/6: Batch creating transactions in Firestore...');
                console.log(`   🔍 Database instance: ${index_1.db ? 'Connected' : 'NOT CONNECTED'}`);
                console.log(`   🔍 Transactions to create: ${final.length}`);
                // Log what we're about to write
                final.forEach((txn, idx) => {
                    var _a;
                    const totalAmount = ((_a = txn.splits) === null || _a === void 0 ? void 0 : _a.reduce((sum, split) => sum + split.amount, 0)) || 0;
                    console.log(`   📝 Transaction ${idx + 1}: ${txn.transactionId} - ${txn.description} ($${totalAmount.toFixed(2)})`);
                });
                const count = await (0, batchCreateTransactions_1.batchCreateTransactions)(final, outflowUpdates);
                console.log(`   ✅ Created ${count} transactions in Firebase`);
                console.log('');
                // Store created transaction IDs for verification
                result.createdTransactionIds = final.map(t => t.transactionId || 'unknown');
                result.transactionsAdded = count;
                // Verify transactions were actually created
                console.log('🔍 Verifying transactions in Firestore...');
                for (const txnId of result.createdTransactionIds) {
                    const txnDoc = await index_1.db.collection('transactions').doc(txnId).get();
                    if (txnDoc.exists) {
                        const data = txnDoc.data();
                        const totalAmount = ((_g = data === null || data === void 0 ? void 0 : data.splits) === null || _g === void 0 ? void 0 : _g.reduce((sum, split) => sum + (split.amount || 0), 0)) || 0;
                        console.log(`   ✅ Verified: ${txnId} - ${data === null || data === void 0 ? void 0 : data.description} ($${totalAmount.toFixed(2)})`);
                    }
                    else {
                        console.error(`   ❌ NOT FOUND: ${txnId}`);
                        result.errors.push(`Transaction ${txnId} was not found in Firestore after creation`);
                    }
                }
                console.log('');
            }
            catch (error) {
                console.error('❌ Error processing added transactions:', error);
                console.error('Stack trace:', error.stack);
                result.errors.push(`Added transactions error: ${error.message}`);
            }
        }
        // === PROCESS MODIFIED TRANSACTIONS ===
        if (SIMULATED_PLAID_RESPONSE.modified.length > 0) {
            console.log('═══════════════════════════════════════════════════════════');
            console.log('⚠️  MODIFIED TRANSACTIONS (Simulated)');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('');
            console.log(`   ℹ️  In production, these would be updated`);
            console.log(`   📊 Count: ${SIMULATED_PLAID_RESPONSE.modified.length} transactions`);
            console.log('');
            result.transactionsModified = SIMULATED_PLAID_RESPONSE.modified.length;
        }
        // === PROCESS REMOVED TRANSACTIONS ===
        if (SIMULATED_PLAID_RESPONSE.removed.length > 0) {
            console.log('═══════════════════════════════════════════════════════════');
            console.log('🗑️  REMOVED TRANSACTIONS (Simulated)');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('');
            console.log(`   ℹ️  In production, these would be soft-deleted`);
            console.log(`   📊 Count: ${SIMULATED_PLAID_RESPONSE.removed.length} transactions`);
            console.log('');
            result.transactionsRemoved = SIMULATED_PLAID_RESPONSE.removed.length;
        }
        // === FINAL SUMMARY ===
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 TEST TRANSACTION CREATION COMPLETE!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('📈 Results:');
        console.log(`   💳 Transactions Added: ${result.transactionsAdded}`);
        console.log(`   💳 Transactions Modified: ${result.transactionsModified} (simulated)`);
        console.log(`   💳 Transactions Removed: ${result.transactionsRemoved} (simulated)`);
        console.log(`   ⚠️  Errors: ${result.errors.length}`);
        console.log('');
        if (result.createdTransactionIds.length > 0) {
            console.log('📋 Created Transaction IDs:');
            result.createdTransactionIds.forEach(id => console.log(`   - ${id}`));
            console.log('');
        }
        if (result.errors.length > 0) {
            console.log('❌ Errors encountered:');
            result.errors.forEach(err => console.log(`   - ${err}`));
            console.log('');
        }
        // Return detailed response
        return {
            success: result.errors.length === 0,
            message: result.errors.length === 0
                ? `✅ Successfully created ${result.transactionsAdded} test transactions`
                : `⚠️  Created ${result.transactionsAdded} transactions with ${result.errors.length} errors`,
            data: {
                targetUserId,
                testItemId,
                currency,
                transactionsAdded: result.transactionsAdded,
                transactionsModified: result.transactionsModified,
                transactionsRemoved: result.transactionsRemoved,
                createdTransactionIds: result.createdTransactionIds,
                errors: result.errors,
                simulatedResponse: {
                    accounts: SIMULATED_PLAID_RESPONSE.accounts.length,
                    added: SIMULATED_PLAID_RESPONSE.added.length,
                    modified: SIMULATED_PLAID_RESPONSE.modified.length,
                    removed: SIMULATED_PLAID_RESPONSE.removed.length
                }
            },
            hint: result.errors.length === 0
                ? 'Check your Firestore emulator UI to see the created transactions'
                : 'Check the errors array and Cloud Functions logs for details'
        };
    }
    catch (error) {
        console.error('');
        console.error('═══════════════════════════════════════════════════════════');
        console.error('❌ FATAL ERROR in createTestTransactions');
        console.error('═══════════════════════════════════════════════════════════');
        console.error(error);
        console.error('');
        throw new https_1.HttpsError('internal', error instanceof Error ? error.message : 'Unknown error occurred', error instanceof Error ? error.stack : undefined);
    }
});
//# sourceMappingURL=createTestTransactions.js.map