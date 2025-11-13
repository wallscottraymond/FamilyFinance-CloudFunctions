/**
 * Create Test Outflows - Admin Function
 *
 * Simulates a Plaid recurring transactions response and runs the complete
 * sync pipeline (format → enhance → batch create) to test the production flow.
 *
 * This function:
 * 1. Creates a test plaid_item (if needed)
 * 2. Simulates Plaid /transactions/recurring/get response
 * 3. Runs the complete inflow/outflow pipeline as it would in production
 * 4. Triggers onOutflowCreated which generates outflow_periods
 *
 * Memory: 512MiB, Timeout: 120s
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { TransactionStream } from 'plaid';
import { formatRecurringInflows } from '../../inflows/utils/formatRecurringInflows';
import { enhanceRecurringInflows } from '../../inflows/utils/enhanceRecurringInflows';
import { formatRecurringOutflows } from '../utils/formatRecurringOutflows';
import { enhanceRecurringOutflows } from '../utils/enhanceRecurringOutflows';
import { batchCreateInflowStreams, batchCreateOutflowStreams } from '../utils/batchCreateRecurringStreams';

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

/**
 * Simulated Plaid recurring transactions response
 * This matches the exact structure returned by Plaid's /transactions/recurring/get endpoint
 */
const SIMULATED_PLAID_RESPONSE = {
  updated_datetime: new Date().toISOString(),
  inflow_streams: [
    {
      account_id: "test_account_checking",
      stream_id: "stream_payroll_001",
      category: null,
      category_id: null,
      description: "Platypus Payroll",
      merchant_name: null,
      personal_finance_category: {
        primary: "INCOME",
        detailed: "INCOME_WAGES",
        confidence_level: "UNKNOWN"
      },
      first_date: "2024-02-28",
      last_date: "2025-11-01",
      predicted_next_date: "2025-11-15",
      frequency: "SEMI_MONTHLY",
      transaction_ids: [
        "txn_payroll_001",
        "txn_payroll_002",
        "txn_payroll_003",
        "txn_payroll_004",
        "txn_payroll_005"
      ],
      average_amount: {
        amount: -800,  // Negative = income in Plaid
        iso_currency_code: "USD",
        unofficial_currency_code: null
      },
      last_amount: {
        amount: -1000,
        iso_currency_code: "USD",
        unofficial_currency_code: null
      },
      is_active: true,
      status: "MATURE",
      is_user_modified: false
    }
  ],
  outflow_streams: [
    {
      account_id: "test_account_checking",
      stream_id: "stream_coned_001",
      category: null,
      category_id: null,
      description: "ConEd Bill Payment",
      merchant_name: "ConEd",
      personal_finance_category: {
        primary: "RENT_AND_UTILITIES",
        detailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
        confidence_level: "UNKNOWN"
      },
      first_date: "2024-02-04",
      last_date: "2025-11-02",
      predicted_next_date: "2025-12-02",
      frequency: "MONTHLY",
      transaction_ids: [
        "txn_coned_001",
        "txn_coned_002",
        "txn_coned_003",
        "txn_coned_004"
      ],
      average_amount: {
        amount: 85,  // Positive = expense in Plaid
        iso_currency_code: "USD",
        unofficial_currency_code: null
      },
      last_amount: {
        amount: 100,
        iso_currency_code: "USD",
        unofficial_currency_code: null
      },
      is_active: true,
      status: "MATURE",
      is_user_modified: false
    },
    {
      account_id: "test_account_checking",
      stream_id: "stream_costco_001",
      category: null,
      category_id: null,
      description: "Costco Annual Membership",
      merchant_name: "Costco",
      personal_finance_category: {
        primary: "GENERAL_MERCHANDISE",
        detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
        confidence_level: "UNKNOWN"
      },
      first_date: "2023-01-23",
      last_date: "2024-01-22",
      predicted_next_date: "2026-01-22",
      frequency: "ANNUALLY",
      transaction_ids: [
        "txn_costco_001",
        "txn_costco_002"
      ],
      average_amount: {
        amount: 120,
        iso_currency_code: "USD",
        unofficial_currency_code: null
      },
      last_amount: {
        amount: 120,
        iso_currency_code: "USD",
        unofficial_currency_code: null
      },
      is_active: true,
      status: "MATURE",
      is_user_modified: false
    }
  ],
  request_id: "test_request_" + Date.now()
};

export const createTestOutflows = onRequest({
  cors: true,
  memory: '512MiB',
  timeoutSeconds: 120,
}, async (req, res) => {
  try {
    console.log('');
    console.log('🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪');
    console.log('🧪 SIMULATING PLAID RECURRING TRANSACTION SYNC');
    console.log('🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪');
    console.log('');

    // Get target user ID from query params or use default
    const targetUserId = req.query.userId as string || 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1';
    const testPlaidItemId = 'test_plaid_item_' + Date.now();
    const testFamilyId = 'test-family-1';

    console.log('📋 Test Configuration:');
    console.log(`  - User ID: ${targetUserId}`);
    console.log(`  - Plaid Item ID: ${testPlaidItemId}`);
    console.log(`  - Family ID: ${testFamilyId}`);
    console.log('');

    const result = {
      inflowsCreated: 0,
      inflowsUpdated: 0,
      outflowsCreated: 0,
      outflowsUpdated: 0,
      outflowPeriodsCreated: 0,
      errors: [] as string[]
    };

    // Step 1: Create a test plaid_item (optional - for completeness)
    console.log('📝 STEP 1: Creating test plaid_item...');
    const plaidItemRef = db.collection('plaid_items').doc();
    await plaidItemRef.set({
      id: plaidItemRef.id,
      plaidItemId: testPlaidItemId,
      userId: targetUserId,
      familyId: testFamilyId,
      institutionId: 'ins_test',
      institutionName: 'Test Bank',
      accessToken: 'encrypted_test_token',
      products: ['transactions'],
      status: 'good',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    console.log(`  ✓ Created test plaid_item: ${plaidItemRef.id}`);
    console.log('');

    // Step 2: Simulate Plaid API response
    console.log('📡 STEP 2: Simulating Plaid /transactions/recurring/get response');
    const rawInflowStreams = SIMULATED_PLAID_RESPONSE.inflow_streams;
    const rawOutflowStreams = SIMULATED_PLAID_RESPONSE.outflow_streams;

    console.log(`  📥 Simulated Response:`);
    console.log(`    - Inflow Streams: ${rawInflowStreams.length}`);
    console.log(`    - Outflow Streams: ${rawOutflowStreams.length}`);
    console.log('');

    // === INFLOW PIPELINE ===
    if (rawInflowStreams.length > 0) {
      console.log('💰 ═══════════════════════════════════════════════════════════');
      console.log('💰 STARTING INFLOW PIPELINE (INCOME)');
      console.log('💰 ═══════════════════════════════════════════════════════════');
      console.log('');

      try {
        // Step 1: Format inflow streams (Plaid → Internal structure)
        console.log('🔄 Step 1/3: Formatting inflow streams...');
        const formattedInflows = await formatRecurringInflows(
          rawInflowStreams as TransactionStream[],
          testPlaidItemId,
          targetUserId,
          testFamilyId
        );
        console.log(`  ✅ Formatted ${formattedInflows.length} inflow streams`);
        console.log('');

        // Step 2: Enhance inflow streams (future transformations placeholder)
        console.log('🔄 Step 2/3: Enhancing inflow streams...');
        const enhancedInflows = await enhanceRecurringInflows(formattedInflows, targetUserId);
        console.log(`  ✅ Enhanced ${enhancedInflows.length} inflow streams`);
        console.log('');

        // Step 3: Batch create/update inflow streams
        console.log('🔄 Step 3/3: Batch creating inflow streams...');
        const inflowResult = await batchCreateInflowStreams(enhancedInflows, targetUserId);
        console.log(`  ✅ Created ${inflowResult.created} inflows`);
        console.log(`  ✅ Updated ${inflowResult.updated} inflows`);
        if (inflowResult.errors.length > 0) {
          console.log(`  ⚠️  Errors: ${inflowResult.errors.length}`);
        }
        console.log('');

        result.inflowsCreated = inflowResult.created;
        result.inflowsUpdated = inflowResult.updated;
        result.errors.push(...inflowResult.errors);
      } catch (error: any) {
        console.error('❌ Error in inflow pipeline:', error);
        result.errors.push(`Inflow pipeline error: ${error.message}`);
      }
    }

    // === OUTFLOW PIPELINE ===
    if (rawOutflowStreams.length > 0) {
      console.log('💸 ═══════════════════════════════════════════════════════════');
      console.log('💸 STARTING OUTFLOW PIPELINE (EXPENSES)');
      console.log('💸 ═══════════════════════════════════════════════════════════');
      console.log('');

      try {
        // Step 1: Format outflow streams (Plaid → Internal structure)
        console.log('🔄 Step 1/3: Formatting outflow streams...');
        const formattedOutflows = await formatRecurringOutflows(
          rawOutflowStreams as TransactionStream[],
          testPlaidItemId,
          targetUserId,
          testFamilyId
        );
        console.log(`  ✅ Formatted ${formattedOutflows.length} outflow streams`);
        formattedOutflows.forEach((outflow, i) => {
          console.log(`    ${i + 1}. ${outflow.description} - $${outflow.averageAmount} ${outflow.frequency}`);
        });
        console.log('');

        // Step 2: Enhance outflow streams (future transformations placeholder)
        console.log('🔄 Step 2/3: Enhancing outflow streams...');
        const enhancedOutflows = await enhanceRecurringOutflows(formattedOutflows, targetUserId);
        console.log(`  ✅ Enhanced ${enhancedOutflows.length} outflow streams`);
        enhancedOutflows.forEach((outflow, i) => {
          console.log(`    ${i + 1}. ${outflow.description}`);
          console.log(`       - Type: ${outflow.expenseType}`);
          console.log(`       - Essential: ${outflow.isEssential}`);
        });
        console.log('');

        // Step 3: Batch create/update outflow streams
        console.log('🔄 Step 3/3: Batch creating outflow streams...');
        console.log('   ⚡ This will trigger onOutflowCreated for each outflow');
        console.log('   ⚡ Which will auto-generate outflow_periods');
        console.log('');

        const outflowResult = await batchCreateOutflowStreams(enhancedOutflows, targetUserId);
        console.log(`  ✅ Created ${outflowResult.created} outflows`);
        console.log(`  ✅ Updated ${outflowResult.updated} outflows`);
        if (outflowResult.errors.length > 0) {
          console.log(`  ⚠️  Errors: ${outflowResult.errors.length}`);
          outflowResult.errors.forEach(err => console.log(`     - ${err}`));
        }
        console.log('');

        result.outflowsCreated = outflowResult.created;
        result.outflowsUpdated = outflowResult.updated;
        result.errors.push(...outflowResult.errors);
      } catch (error: any) {
        console.error('❌ Error in outflow pipeline:', error);
        result.errors.push(`Outflow pipeline error: ${error.message}`);
      }
    }

    // Step 3: Wait for triggers to complete and check results
    console.log('⏳ STEP 3: Waiting for onOutflowCreated triggers to complete...');
    console.log('   (Triggers generate outflow_periods for each outflow)');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('');

    // Check outflow periods created
    console.log('📊 STEP 4: Checking results...');
    const outflowPeriodsSnapshot = await db.collection('outflow_periods')
      .where('userId', '==', targetUserId)
      .get();

    result.outflowPeriodsCreated = outflowPeriodsSnapshot.size;

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 SYNC SIMULATION COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('📈 Final Results:');
    console.log(`  💰 Inflows Created: ${result.inflowsCreated}`);
    console.log(`  💰 Inflows Updated: ${result.inflowsUpdated}`);
    console.log(`  💸 Outflows Created: ${result.outflowsCreated}`);
    console.log(`  💸 Outflows Updated: ${result.outflowsUpdated}`);
    console.log(`  📅 Outflow Periods Created: ${result.outflowPeriodsCreated}`);
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
      message: `Simulated Plaid sync completed: ${result.inflowsCreated} inflows, ${result.outflowsCreated} outflows, ${result.outflowPeriodsCreated} periods`,
      data: {
        targetUserId,
        testPlaidItemId,
        testFamilyId,
        inflowsCreated: result.inflowsCreated,
        inflowsUpdated: result.inflowsUpdated,
        outflowsCreated: result.outflowsCreated,
        outflowsUpdated: result.outflowsUpdated,
        outflowPeriodsCreated: result.outflowPeriodsCreated,
        errors: result.errors,
        simulatedResponse: {
          inflowStreams: rawInflowStreams.length,
          outflowStreams: rawOutflowStreams.length
        }
      }
    });

  } catch (error) {
    console.error('');
    console.error('❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌❌');
    console.error('❌ FATAL ERROR in createTestOutflows');
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
