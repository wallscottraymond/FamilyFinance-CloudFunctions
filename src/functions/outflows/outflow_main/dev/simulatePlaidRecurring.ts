/**
 * Simulate Plaid Recurring Transactions - Dev Testing Function
 *
 * This function simulates receiving recurring transaction data from Plaid
 * and processes it through the standard pipeline (format → enhance → batch create).
 *
 * Use this to test the complete Plaid → Firestore pipeline without needing
 * actual Plaid credentials or API calls.
 *
 * Query Parameters:
 * - userId (optional): User ID to create streams for (default: IKzBkwEZb6MdJkdDVnVyTFAFj5i1)
 * - groupId (optional): Group ID for streams (default: test-family-1)
 * - permutation (optional): Which test scenario to run (default: standard)
 *
 * Available Permutations:
 * - "standard": Your provided Plaid response (1 inflow, 2 outflows)
 *
 * Example Usage:
 * GET http://127.0.0.1:5001/family-budget-app-cb59b/us-central1/simulatePlaidRecurring?permutation=standard
 */

import { onRequest } from 'firebase-functions/v2/https';
import { formatRecurringInflows } from '../../../inflows/utils/formatRecurringInflows';
import { enhanceRecurringInflows } from '../../../inflows/utils/enhanceRecurringInflows';
import { formatRecurringOutflows, enhanceRecurringOutflows, batchCreateInflowStreams, batchCreateOutflowStreams } from '../utils';

// Mock Plaid Response - Permutation 1: "standard"
const MOCK_PLAID_STANDARD = {
  updated_datetime: "2022-05-01T00:00:00Z",
  inflow_streams: [
    {
      account_id: "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje",
      stream_id: "FINAL_Payroll_v3",
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
      last_date: "2024-04-30",
      predicted_next_date: "2024-05-15",
      frequency: "SEMI_MONTHLY",
      transaction_ids: [
        "123abc",
        "EfC5ekksdy30KuNzad2tQupW8WIPwvjXGbGHL",
        "ozfvj3FFgp6frbXKJGitsDzck5eWQH7zOJBYd",
        "QvdDE8AqVWo3bkBZ7WvCd7LskxVix8Q74iMoK",
        "uQozFPfMzibBouS9h9tz4CsyvFll17jKLdPAF"
      ],
      average_amount: {
        amount: -800,
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
      account_id: "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDff",
      stream_id: "FINAL_ConEd_v3",
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
      last_date: "2024-05-02",
      predicted_next_date: "2024-06-02",
      frequency: "MONTHLY",
      transaction_ids: [
        "123abc",
        "HPDnUVgI5Pa0YQSl0rxwYRwVXeLyJXTWDAvpR",
        "jEPoSfF8xzMClE9Ohj1he91QnvYoSdwg7IT8L",
        "CmdQTNgems8BT1B7ibkoUXVPyAeehT3Tmzk0l"
      ],
      average_amount: {
        amount: 85,
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
      account_id: "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDff",
      stream_id: "FINAL_Costco_v3",
      category: null,
      category_id: null,
      description: "Costco Annual Membership",
      merchant_name: "Costco",
      personal_finance_category: {
        primary: "GENERAL_MERCHANDISE",
        detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
        confidence_level: "UNKNOWN"
      },
      first_date: "2024-01-23",
      last_date: "2025-01-22",
      predicted_next_date: "2026-01-22",
      frequency: "ANNUALLY",
      transaction_ids: [
        "yqEBJ72cS4jFwcpxJcDuQr94oAQ1R1lMC33D4",
        "Kz5Hm3cZCgpn4tMEKUGAGD6kAcxMBsEZDSwJJ"
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
  request_id: "mock_request_standard"
};

/**
 * Get mock data based on permutation
 */
function getMockPlaidData(permutation: string) {
  switch (permutation) {
    case 'standard':
    default:
      return MOCK_PLAID_STANDARD;
  }
}

export const simulatePlaidRecurring = onRequest({
  cors: true,
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (req, res) => {
  try {
    // Extract query parameters
    const userId = (req.query.userId as string) || 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1';
    const groupId = (req.query.groupId as string) || 'test-family-1';
    const permutation = (req.query.permutation as string) || 'standard';

    console.log(`🧪 [simulatePlaidRecurring] Starting simulation...`);
    console.log(`   Permutation: ${permutation}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Group ID: ${groupId}`);

    // Get mock Plaid data
    const mockPlaidData = getMockPlaidData(permutation);
    const rawInflowStreams = mockPlaidData.inflow_streams || [];
    const rawOutflowStreams = mockPlaidData.outflow_streams || [];

    console.log(`📊 Mock data: ${rawInflowStreams.length} inflows, ${rawOutflowStreams.length} outflows`);

    const result = {
      inflowsCreated: 0,
      inflowsUpdated: 0,
      outflowsCreated: 0,
      outflowsUpdated: 0,
      errors: [] as string[],
      details: {
        inflows: [] as string[],
        outflows: [] as string[]
      }
    };

    // Mock Plaid item ID
    const mockPlaidItemId = 'test-plaid-item-123';

    // === INFLOW PIPELINE ===
    if (rawInflowStreams.length > 0) {
      console.log(`🔄 === STARTING INFLOW PIPELINE ===`);

      try {
        // Step 1: Format inflow streams (Plaid → Internal structure)
        const formattedInflows = await formatRecurringInflows(
          rawInflowStreams as any,  // Use 'as any' for mock Plaid data
          mockPlaidItemId,
          userId,
          groupId
        );
        console.log(`✅ Step 1/3: Formatted ${formattedInflows.length} inflow streams`);

        // Step 2: Enhance inflow streams (business logic)
        const enhancedInflows = await enhanceRecurringInflows(formattedInflows, userId);
        console.log(`✅ Step 2/3: Enhanced ${enhancedInflows.length} inflow streams`);

        // Step 3: Batch create/update inflow streams
        const inflowResult = await batchCreateInflowStreams(enhancedInflows, userId);
        console.log(`✅ Step 3/3: Created ${inflowResult.created} inflows, updated ${inflowResult.updated} inflows`);

        result.inflowsCreated = inflowResult.created;
        result.inflowsUpdated = inflowResult.updated;
        result.errors.push(...inflowResult.errors);
        // Store inflow IDs from formatted inflows
        result.details.inflows = formattedInflows.map(i => i.id || 'unknown');
      } catch (error: any) {
        console.error('❌ Inflow pipeline error:', error);
        result.errors.push(`Inflow pipeline: ${error.message}`);
      }
    }

    // === OUTFLOW PIPELINE ===
    if (rawOutflowStreams.length > 0) {
      console.log(`🔄 === STARTING OUTFLOW PIPELINE ===`);

      try {
        // Step 1: Format outflow streams (Plaid → Internal structure)
        const formattedOutflows = await formatRecurringOutflows(
          rawOutflowStreams as any,  // Use 'as any' for mock Plaid data
          mockPlaidItemId,
          userId,
          groupId
        );
        console.log(`✅ Step 1/3: Formatted ${formattedOutflows.length} outflow streams`);

        // Step 2: Enhance outflow streams (business logic)
        const enhancedOutflows = await enhanceRecurringOutflows(formattedOutflows, userId);
        console.log(`✅ Step 2/3: Enhanced ${enhancedOutflows.length} outflow streams`);

        // Step 3: Batch create/update outflow streams
        const outflowResult = await batchCreateOutflowStreams(enhancedOutflows, userId);
        console.log(`✅ Step 3/3: Created ${outflowResult.created} outflows, updated ${outflowResult.updated} outflows`);

        result.outflowsCreated = outflowResult.created;
        result.outflowsUpdated = outflowResult.updated;
        result.errors.push(...outflowResult.errors);
        // Store outflow IDs from formatted outflows
        result.details.outflows = formattedOutflows.map(o => o.id || 'unknown');
      } catch (error: any) {
        console.error('❌ Outflow pipeline error:', error);
        result.errors.push(`Outflow pipeline: ${error.message}`);
      }
    }

    console.log(`✅ Simulation complete:`, result);

    // Return response
    res.status(200).json({
      success: true,
      permutation,
      userId,
      groupId,
      ...result
    });

  } catch (error: any) {
    console.error('❌ Error in simulatePlaidRecurring:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});
