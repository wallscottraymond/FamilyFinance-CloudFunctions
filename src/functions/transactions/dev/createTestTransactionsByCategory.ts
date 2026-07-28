/**
 * Create Test Transactions By Category - Development Function
 *
 * Generates 5 transactions for each category in the categories collection.
 * Transaction names follow pattern: "{category_name} {number}"
 * Income categories = credits (positive), Outflow categories = debits (negative)
 * Dates spread evenly across the current month
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../../index';
import { formatTransactions } from '../utils/formatTransactions';
import { matchCategoriesToTransactions } from '../utils/matchCategoriesToTransactions';
import { matchTransactionSplitsToSourcePeriods } from '../utils/matchTransactionSplitsToSourcePeriods';
import { matchTransactionSplitsToOutflows } from '../utils/matchTransactionSplitsToOutflows';
import { batchCreateTransactions } from '../utils/batchCreateTransactions';
import { Transaction as PlaidTransaction } from 'plaid';

interface Category {
  id: string;
  name: string;
  type: 'Income' | 'Outflow';
  primary_plaid_category: string;
  detailed_plaid_category: string;
}

/**
 * Generate evenly spaced dates within the current month
 */
function generateDateRange(count: number): Date[] {
  const now = new Date();

  // First day of current month
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);

  // Last day of current month
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const interval = Math.floor(totalDays / (count - 1));

  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + (i * interval));
    dates.push(date);
  }

  return dates;
}

/**
 * Format date as YYYY-MM-DD for Plaid transaction
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate random amount based on category type
 */
function generateAmount(type: 'Income' | 'Outflow'): number {
  // Income: $500 - $5000
  // Outflow: $10 - $500
  if (type === 'Income') {
    return Math.floor(Math.random() * 4500) + 500;  // $500-$5000
  } else {
    return Math.floor(Math.random() * 490) + 10;    // $10-$500
  }
}

/**
 * Firebase Callable Function to create test transactions for all categories
 */
export const createTestTransactionsByCategory = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,  // 5 minutes for large batch
}, async (request) => {
  // Verify user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to create test transactions');
  }

  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🧪 DEV: Creating Test Transactions By Category');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const targetUserId = request.auth.uid;
    console.log(`👤 Authenticated user: ${targetUserId}`);

    // Verify user exists
    const userDoc = await db.collection('users').doc(targetUserId).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', `User not found: ${targetUserId}`);
    }
    console.log(`✅ User verified: ${userDoc.data()?.email || 'No email'}`);
    console.log('');

    // Fetch all active categories
    console.log('📋 Fetching categories from Firestore...');
    const categoriesSnapshot = await db.collection('categories')
      .where('isActive', '==', true)
      .get();

    if (categoriesSnapshot.empty) {
      throw new HttpsError('not-found', 'No active categories found in database');
    }

    const categories: Category[] = categoriesSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      type: doc.data().type,
      primary_plaid_category: doc.data().primary_plaid_category || 'GENERAL_MERCHANDISE',
      detailed_plaid_category: doc.data().detailed_plaid_category || 'GENERAL_MERCHANDISE_OTHER'
    }));

    console.log(`✅ Found ${categories.length} active categories`);
    console.log('');

    // Create test account (simulated Plaid account)
    const testItemId = 'test_plaid_item_' + Date.now();
    const testAccountId = 'test_account_' + Date.now();
    const currency = 'USD';

    console.log('🏦 Creating test account in Firestore...');
    const testAccount = {
      accountId: testAccountId,
      plaidAccountId: testAccountId,
      userId: targetUserId,
      itemId: testItemId,
      institutionId: 'ins_test',
      institutionName: 'Test Bank',
      accountName: 'Test Checking Account',
      accountType: 'depository',
      accountSubtype: 'checking',
      mask: '0000',
      officialName: 'Test Checking Account',
      currentBalance: 10000.00,
      availableBalance: 10000.00,
      limit: null,
      isoCurrencyCode: 'USD',
      isActive: true,
      isSyncEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastBalanceUpdate: new Date()
    };

    await db.collection('accounts').doc(testAccountId).set(testAccount);
    console.log(`✅ Test account created: ${testAccountId}`);
    console.log('');

    // Generate evenly spaced dates for 5 transactions per category
    const transactionDates = generateDateRange(5);
    console.log(`📅 Generated ${transactionDates.length} evenly spaced dates:`);
    transactionDates.forEach((date, i) => {
      console.log(`   ${i + 1}. ${formatDate(date)}`);
    });
    console.log('');

    // Generate Plaid-format transactions for all categories
    console.log('💳 Generating Plaid-format transactions...');
    const plaidTransactions: PlaidTransaction[] = [];
    let transactionCounter = 1;

    categories.forEach(category => {
      console.log(`   📂 Category: ${category.name} (${category.type})`);

      transactionDates.forEach((date, index) => {
        const amount = generateAmount(category.type);
        const transactionName = `${category.name} ${index + 1}`;
        const transactionId = `txn_${category.id}_${index + 1}_${Date.now()}`;

        // Income = negative amount (credit), Outflow = positive amount (debit) in Plaid format
        const plaidAmount = category.type === 'Income' ? -amount : amount;

        const plaidTransaction: PlaidTransaction = {
          account_id: testAccountId,
          account_owner: null,
          amount: plaidAmount,
          iso_currency_code: 'USD',
          unofficial_currency_code: null,
          check_number: null,
          counterparties: [
            {
              name: transactionName,
              type: 'merchant',
              logo_url: null,
              website: null,
              entity_id: null,
              confidence_level: null
            }
          ],
          date: formatDate(date),
          datetime: `${formatDate(date)}T12:00:00Z`,
          authorized_date: formatDate(date),
          authorized_datetime: `${formatDate(date)}T12:00:00Z`,
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
          name: transactionName,
          merchant_name: transactionName,
          merchant_entity_id: null,
          logo_url: null,
          website: null,
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
          payment_channel: 'other',
          pending: false,
          pending_transaction_id: null,
          personal_finance_category: {
            primary: category.primary_plaid_category,
            detailed: category.detailed_plaid_category,
            confidence_level: 'VERY_HIGH'
          },
          personal_finance_category_icon_url: undefined,
          transaction_id: transactionId,
          transaction_code: null,
          transaction_type: 'place'
        } as PlaidTransaction;

        plaidTransactions.push(plaidTransaction);

        console.log(`   ✓ ${transactionName}: $${amount.toFixed(2)} on ${formatDate(date)} (${category.type})`);
        transactionCounter++;
      });
    });

    console.log('');
    console.log(`✅ Generated ${plaidTransactions.length} Plaid-format transactions`);
    console.log('');

    // Process through 6-step pipeline
    console.log('═══════════════════════════════════════════════════════════');
    console.log('💳 PROCESSING TRANSACTIONS (6-Step Pipeline)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // Step 1: Format transactions
    console.log('⚙️  Step 1/6: Formatting transactions...');
    const formatted = await formatTransactions(
      plaidTransactions,
      testItemId,
      targetUserId,
      undefined, // groupId = null
      currency
    );
    console.log(`   ✅ Formatted ${formatted.length} transactions`);
    console.log('');

    // Step 2: Match categories
    console.log('⚙️  Step 2/6: Matching categories...');
    const withCategories = await matchCategoriesToTransactions(formatted, targetUserId);
    console.log(`   ✅ Matched categories for ${withCategories.length} transactions`);
    console.log('');

    // Step 3: Match source periods
    console.log('⚙️  Step 3/6: Matching source periods...');
    const withPeriods = await matchTransactionSplitsToSourcePeriods(withCategories);
    console.log(`   ✅ Matched ${withPeriods.length} transactions to source periods`);
    console.log('');

    // Step 4: (budget matching removed 2026-07-27) — the Transaction Assignment
    // Engine assigns budgets via on_transaction_written after these docs are
    // written, so seeded test data is homed by the SAME single authority as
    // production. Splits are written unassigned; the engine assigns them.

    // Step 5: Match outflows
    console.log('⚙️  Step 5/6: Matching outflows...');
    const { transactions: final, outflowUpdates } = await matchTransactionSplitsToOutflows(withPeriods, targetUserId);
    console.log(`   ✅ Matched outflow IDs for ${final.length} transactions`);
    console.log(`   ✅ Generated ${outflowUpdates.length} outflow updates`);
    console.log('');

    // Step 6: Batch create transactions
    console.log('⚙️  Step 6/6: Batch creating transactions in Firestore...');
    const count = await batchCreateTransactions(final, outflowUpdates);
    console.log(`   ✅ Created ${count} transactions in Firebase`);
    console.log('');

    // Verify transactions created
    console.log('🔍 Verifying sample transactions in Firestore...');
    const sampleIds = final.slice(0, 5).map(t => t.transactionId || 'unknown');
    for (const txnId of sampleIds) {
      const txnDoc = await db.collection('transactions').doc(txnId).get();
      if (txnDoc.exists) {
        const data = txnDoc.data();
        console.log(`   ✅ Verified: ${data?.description}`);
      }
    }
    console.log('');

    // Calculate date range for output
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthName = startOfMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

    // Final summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 TEST TRANSACTION CREATION COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('📈 Results:');
    console.log(`   📂 Categories Processed: ${categories.length}`);
    console.log(`   💳 Transactions Created: ${count}`);
    console.log(`   📅 Date Range: ${monthName}`);
    console.log(`   💰 Income Transactions: ${categories.filter(c => c.type === 'Income').length * 5}`);
    console.log(`   💸 Outflow Transactions: ${categories.filter(c => c.type === 'Outflow').length * 5}`);
    console.log('');

    return {
      success: true,
      message: `✅ Successfully created ${count} test transactions across ${categories.length} categories`,
      data: {
        targetUserId,
        testItemId,
        testAccountId,
        categoriesProcessed: categories.length,
        transactionsCreated: count,
        dateRange: {
          start: formatDate(startOfMonth),
          end: formatDate(endOfMonth)
        },
        incomeTransactions: categories.filter(c => c.type === 'Income').length * 5,
        outflowTransactions: categories.filter(c => c.type === 'Outflow').length * 5
      },
      hint: `Check your Firestore emulator UI to see the created transactions. Transactions are spread evenly across ${monthName} with 5 per category.`
    };

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('❌ FATAL ERROR in createTestTransactionsByCategory');
    console.error('═══════════════════════════════════════════════════════════');
    console.error(error);
    console.error('');

    throw new HttpsError('internal',
      error instanceof Error ? error.message : 'Unknown error occurred',
      error instanceof Error ? error.stack : undefined
    );
  }
});
