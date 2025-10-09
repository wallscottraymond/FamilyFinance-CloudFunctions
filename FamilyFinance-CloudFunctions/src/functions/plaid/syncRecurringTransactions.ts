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
import { authenticateRequest, UserRole } from '../../utils/auth';
import { getAccessToken } from '../../utils/encryption';
import { createStandardPlaidClient } from '../../utils/plaidClientFactory';
import { RecurringIncome, RecurringOutflow } from '../../types';
import { createDocument, updateDocument, queryDocuments } from '../../utils/firestore';
import { db } from '../../index';
import { Timestamp } from 'firebase-admin/firestore';

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

    const inflowStreams = recurringResponse.data.inflow_streams || [];
    const outflowStreams = recurringResponse.data.outflow_streams || [];

    console.log(`📥 Retrieved ${inflowStreams.length} inflow streams and ${outflowStreams.length} outflow streams`);

    // Step 3: Process inflow streams (recurring income)
    for (const stream of inflowStreams) {
      try {
        // Check if stream already exists
        const existingQuery = await queryDocuments('inflows', {
          where: [
            { field: 'streamId', operator: '==', value: stream.stream_id },
            { field: 'userId', operator: '==', value: userId }
          ],
          limit: 1
        });

        if (existingQuery.length > 0) {
          // Update existing stream
          const existingDoc = existingQuery[0];
          await updateDocument('inflows', existingDoc.id!, {
            description: stream.description,
            merchantName: stream.merchant_name,
            averageAmount: {
              amount: stream.average_amount.amount,
              isoCurrencyCode: stream.average_amount.iso_currency_code
            },
            lastAmount: {
              amount: stream.last_amount.amount,
              isoCurrencyCode: stream.last_amount.iso_currency_code
            },
            frequency: stream.frequency,
            lastDate: Timestamp.fromDate(new Date(stream.last_date)),
            predictedNextDate: stream.predicted_next_date
              ? Timestamp.fromDate(new Date(stream.predicted_next_date))
              : undefined,
            transactionIds: stream.transaction_ids,
            status: stream.status,
            isActive: stream.is_active,
            isUserModified: stream.is_user_modified,
            lastSyncedAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.inflowsUpdated++;
        } else {
          // Create new stream
          const inflowDoc: Omit<RecurringIncome, 'id' | 'createdAt' | 'updatedAt'> = {
            streamId: stream.stream_id,
            itemId: plaidItemId,
            userId,
            familyId: itemData.familyId,
            accountId: stream.account_id,
            isActive: stream.is_active,
            status: stream.status as any,
            description: stream.description,
            merchantName: stream.merchant_name || undefined,
            category: stream.category || [],
            personalFinanceCategory: stream.personal_finance_category ? {
              primary: stream.personal_finance_category.primary,
              detailed: stream.personal_finance_category.detailed,
              confidenceLevel: stream.personal_finance_category.confidence_level || undefined
            } : undefined,
            averageAmount: {
              amount: stream.average_amount.amount || 0,
              isoCurrencyCode: stream.average_amount.iso_currency_code || undefined
            },
            lastAmount: {
              amount: stream.last_amount.amount || 0,
              isoCurrencyCode: stream.last_amount.iso_currency_code || undefined
            },
            frequency: stream.frequency as any,
            firstDate: Timestamp.fromDate(new Date(stream.first_date)),
            lastDate: Timestamp.fromDate(new Date(stream.last_date)),
            predictedNextDate: stream.predicted_next_date
              ? Timestamp.fromDate(new Date(stream.predicted_next_date))
              : undefined,
            transactionIds: stream.transaction_ids,
            isUserModified: stream.is_user_modified,
            tags: [],
            isHidden: false,
            lastSyncedAt: Timestamp.now(),
            syncVersion: 1
          };

          await createDocument('inflows', inflowDoc);
          result.inflowsCreated++;
        }
      } catch (error) {
        const errorMsg = `Failed to process inflow stream ${stream.stream_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Step 4: Process outflow streams (recurring expenses)
    for (const stream of outflowStreams) {
      try {
        // Check if stream already exists
        const existingQuery = await queryDocuments('outflows', {
          where: [
            { field: 'streamId', operator: '==', value: stream.stream_id },
            { field: 'userId', operator: '==', value: userId }
          ],
          limit: 1
        });

        if (existingQuery.length > 0) {
          // Update existing stream
          const existingDoc = existingQuery[0];
          await updateDocument('outflows', existingDoc.id!, {
            description: stream.description,
            merchantName: stream.merchant_name,
            averageAmount: {
              amount: stream.average_amount.amount,
              isoCurrencyCode: stream.average_amount.iso_currency_code
            },
            lastAmount: {
              amount: stream.last_amount.amount,
              isoCurrencyCode: stream.last_amount.iso_currency_code
            },
            frequency: stream.frequency,
            lastDate: Timestamp.fromDate(new Date(stream.last_date)),
            predictedNextDate: stream.predicted_next_date
              ? Timestamp.fromDate(new Date(stream.predicted_next_date))
              : undefined,
            transactionIds: stream.transaction_ids,
            status: stream.status,
            isActive: stream.is_active,
            isUserModified: stream.is_user_modified,
            lastSyncedAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.outflowsUpdated++;
        } else {
          // Create new stream
          const outflowDoc: Omit<RecurringOutflow, 'id' | 'createdAt' | 'updatedAt'> = {
            streamId: stream.stream_id,
            itemId: plaidItemId,
            userId,
            familyId: itemData.familyId,
            accountId: stream.account_id,
            isActive: stream.is_active,
            status: stream.status as any,
            description: stream.description,
            merchantName: stream.merchant_name || undefined,
            category: stream.category || [],
            personalFinanceCategory: stream.personal_finance_category ? {
              primary: stream.personal_finance_category.primary,
              detailed: stream.personal_finance_category.detailed,
              confidenceLevel: stream.personal_finance_category.confidence_level || undefined
            } : undefined,
            averageAmount: {
              amount: stream.average_amount.amount || 0,
              isoCurrencyCode: stream.average_amount.iso_currency_code || undefined
            },
            lastAmount: {
              amount: stream.last_amount.amount || 0,
              isoCurrencyCode: stream.last_amount.iso_currency_code || undefined
            },
            frequency: stream.frequency as any,
            firstDate: Timestamp.fromDate(new Date(stream.first_date)),
            lastDate: Timestamp.fromDate(new Date(stream.last_date)),
            predictedNextDate: stream.predicted_next_date
              ? Timestamp.fromDate(new Date(stream.predicted_next_date))
              : undefined,
            transactionIds: stream.transaction_ids,
            isUserModified: stream.is_user_modified,
            tags: [],
            isHidden: false,
            lastSyncedAt: Timestamp.now(),
            syncVersion: 1
          };

          await createDocument('outflows', outflowDoc);
          result.outflowsCreated++;
        }
      } catch (error) {
        const errorMsg = `Failed to process outflow stream ${stream.stream_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
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
