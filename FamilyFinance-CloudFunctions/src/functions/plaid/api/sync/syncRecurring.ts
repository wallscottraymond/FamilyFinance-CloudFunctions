/**
 * Sync Recurring Transactions Function
 *
 * Fetches recurring transaction streams from Plaid and stores them in
 * the inflow (recurring income) and outflow (recurring expenses) collections.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token
 * 2. Call Plaid /transactions/recurring/get
 * 3. Store inflow streams in inflow collection
 * 4. Store outflow streams in outflow collection
 *
 * Memory: 512MiB, Timeout: 120s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { authenticateRequest, UserRole } from '../../../../utils/auth';
import { getAccessToken } from '../../../../utils/encryption';
import { createStandardPlaidClient } from '../../../../utils/plaidClientFactory';
import { db } from '../../../../index';
import { Timestamp } from 'firebase-admin/firestore';
import { formatInflowStreams, formatOutflowStreams } from '../../../outflows/utils/formatRecurringStreams';
import { enhanceInflowStreams, enhanceOutflowStreams } from '../../../outflows/utils/enhanceRecurringStreams';
import { batchCreateInflowStreams, batchCreateOutflowStreams } from '../../../outflows/utils/batchCreateRecurringStreams';

// Define secrets
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
const tokenEncryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

/**
 * Callable function for manual recurring transaction sync
 */
export const syncRecurringTransactionsCallable = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (request) => {
    try {
      // Authenticate user
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      const { plaidItemId } = request.data;

      if (!plaidItemId) {
        throw new HttpsError('invalid-argument', 'plaidItemId is required');
      }

      console.log(`🔄 Manual recurring transaction sync requested for item: ${plaidItemId}, user: ${userId}`);

      const result = await syncRecurringTransactions(plaidItemId, userId);

      return {
        success: true,
        ...result
      };

    } catch (error: any) {
      console.error('Error in manual recurring transaction sync:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to sync recurring transactions');
    }
  }
);

/**
 * Internal sync recurring transactions function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID
 * @returns Sync result with inflow/outflow counts
 */
export async function syncRecurringTransactions(
  plaidItemId: string,
  userId: string
): Promise<{
  inflowsCreated: number;
  inflowsUpdated: number;
  outflowsCreated: number;
  outflowsUpdated: number;
  errors: string[];
}> {
  console.log(`🔄 Starting recurring transaction sync for item ${plaidItemId}, user ${userId}`);

  const result = {
    inflowsCreated: 0,
    inflowsUpdated: 0,
    outflowsCreated: 0,
    outflowsUpdated: 0,
    errors: [] as string[]
  };

  try {
    // Step 1: Find the plaid_item to get access token
    const itemQuery = await db.collection('plaid_items')
      .where('plaidItemId', '==', plaidItemId)
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (itemQuery.empty) {
      throw new Error(`Plaid item not found: ${plaidItemId}`);
    }

    const itemDoc = itemQuery.docs[0];
    const itemData = itemDoc.data();
    const encryptedAccessToken = itemData.accessToken;

    if (!encryptedAccessToken) {
      throw new Error('No access token found for item');
    }

    // Decrypt access token
    const accessToken = getAccessToken(encryptedAccessToken);

    // Step 2: Call Plaid /transactions/recurring/get
    const plaidClient = createStandardPlaidClient();

    console.log(`📡 Calling Plaid /transactions/recurring/get for item ${plaidItemId}`);
    const recurringResponse = await plaidClient.transactionsRecurringGet({
      access_token: accessToken,
    });

    const rawInflowStreams = recurringResponse.data.inflow_streams || [];
    const rawOutflowStreams = recurringResponse.data.outflow_streams || [];

    console.log(`📥 Retrieved ${rawInflowStreams.length} inflow streams and ${rawOutflowStreams.length} outflow streams`);

    // === INFLOW PIPELINE ===
    if (rawInflowStreams.length > 0) {
      console.log(`🔄 [syncRecurringTransactions] === STARTING INFLOW PIPELINE ===`);

      // Step 1: Format inflow streams (Plaid → Internal structure)
      const formattedInflows = await formatInflowStreams(
        rawInflowStreams,
        plaidItemId,
        userId,
        itemData.familyId
      );
      console.log(`✅ Step 1/3: Formatted ${formattedInflows.length} inflow streams`);

      // Step 2: Enhance inflow streams (future transformations placeholder)
      const enhancedInflows = await enhanceInflowStreams(formattedInflows, userId);
      console.log(`✅ Step 2/3: Enhanced ${enhancedInflows.length} inflow streams`);

      // Step 3: Batch create/update inflow streams
      const inflowResult = await batchCreateInflowStreams(enhancedInflows, userId);
      console.log(`✅ Step 3/3: Created ${inflowResult.created} inflows, updated ${inflowResult.updated} inflows`);

      result.inflowsCreated = inflowResult.created;
      result.inflowsUpdated = inflowResult.updated;
      result.errors.push(...inflowResult.errors);
    }

    // === OUTFLOW PIPELINE ===
    if (rawOutflowStreams.length > 0) {
      console.log(`🔄 [syncRecurringTransactions] === STARTING OUTFLOW PIPELINE ===`);

      // Step 1: Format outflow streams (Plaid → Internal structure)
      const formattedOutflows = await formatOutflowStreams(
        rawOutflowStreams,
        plaidItemId,
        userId,
        itemData.familyId
      );
      console.log(`✅ Step 1/3: Formatted ${formattedOutflows.length} outflow streams`);

      // Step 2: Enhance outflow streams (future transformations placeholder)
      const enhancedOutflows = await enhanceOutflowStreams(formattedOutflows, userId);
      console.log(`✅ Step 2/3: Enhanced ${enhancedOutflows.length} outflow streams`);

      // Step 3: Batch create/update outflow streams
      const outflowResult = await batchCreateOutflowStreams(enhancedOutflows, userId);
      console.log(`✅ Step 3/3: Created ${outflowResult.created} outflows, updated ${outflowResult.updated} outflows`);

      result.outflowsCreated = outflowResult.created;
      result.outflowsUpdated = outflowResult.updated;
      result.errors.push(...outflowResult.errors);
    }


    // Update the plaid_item with last recurring sync time
    await itemDoc.ref.update({
      lastRecurringSyncedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    console.log(`✅ Recurring transaction sync completed:`, result);

    return result;

  } catch (error: any) {
    console.error(`❌ Error syncing recurring transactions for item ${plaidItemId}:`, error);
    result.errors.push(error.message || 'Unknown sync error');
    return result;
  }
}
