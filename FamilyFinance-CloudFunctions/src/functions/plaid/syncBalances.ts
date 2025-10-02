/**
 * Sync Balances Function
 *
 * Fetches current account balances from Plaid and updates the accounts collection.
 * This function is called by the onPlaidItemCreated trigger and can also be
 * called manually for balance refreshes.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token
 * 2. Call Plaid /accounts/balance/get
 * 3. Update accounts collection with latest balances
 *
 * Memory: 256MiB, Timeout: 60s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { authenticateRequest, UserRole } from '../../utils/auth';
import { getAccessToken } from '../../utils/encryption';
import { createStandardPlaidClient } from '../../utils/plaidClientFactory';
import { db } from '../../index';
import { Timestamp } from 'firebase-admin/firestore';
import { AccountsBalanceGetRequest } from 'plaid';

// Define secrets
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
const tokenEncryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

/**
 * Callable function for manual balance sync
 */
export const syncBalancesCallable = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 60,
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

      console.log(`🔄 Manual balance sync requested for item: ${plaidItemId}, user: ${userId}`);

      const result = await syncBalances(plaidItemId, userId);

      return {
        success: true,
        ...result
      };

    } catch (error: any) {
      console.error('Error in manual balance sync:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to sync balances');
    }
  }
);

/**
 * Internal sync balances function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID (for validation)
 * @returns Sync result with account counts
 */
export async function syncBalances(
  plaidItemId: string,
  userId: string
): Promise<{
  accountsUpdated: number;
  errors: string[];
}> {
  console.log(`📊 Starting balance sync for item ${plaidItemId}, user ${userId}`);

  const result = {
    accountsUpdated: 0,
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

    // Step 2: Create Plaid client and fetch balances
    const plaidClient = createStandardPlaidClient();

    const balanceRequest: AccountsBalanceGetRequest = {
      access_token: accessToken
    };

    console.log(`📡 Calling Plaid /accounts/balance/get for item ${plaidItemId}`);
    const balanceResponse = await plaidClient.accountsBalanceGet(balanceRequest);
    const accounts = balanceResponse.data.accounts;

    console.log(`📥 Retrieved ${accounts.length} accounts from Plaid`);

    // Step 3: Update each account in the accounts collection
    for (const plaidAccount of accounts) {
      try {
        // Find the account document
        const accountQuery = await db.collection('accounts')
          .where('plaidAccountId', '==', plaidAccount.account_id)
          .where('userId', '==', userId)
          .limit(1)
          .get();

        if (accountQuery.empty) {
          console.warn(`Account not found in accounts collection: ${plaidAccount.account_id}`);
          result.errors.push(`Account ${plaidAccount.account_id} not found`);
          continue;
        }

        const accountDoc = accountQuery.docs[0];

        // Update balance information
        await accountDoc.ref.update({
          balance: plaidAccount.balances.current,
          availableBalance: plaidAccount.balances.available,
          limit: plaidAccount.balances.limit,
          isoCurrencyCode: plaidAccount.balances.iso_currency_code,
          lastBalanceUpdate: Timestamp.now(),
          updatedAt: Timestamp.now()
        });

        result.accountsUpdated++;
        console.log(`✅ Updated balance for account ${plaidAccount.name}: ${plaidAccount.balances.current}`);

      } catch (error) {
        const errorMsg = `Failed to update account ${plaidAccount.account_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Update the plaid_item with last sync time
    await itemDoc.ref.update({
      lastBalanceSyncedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    console.log(`✅ Balance sync completed: ${result.accountsUpdated} accounts updated`);

    return result;

  } catch (error: any) {
    console.error(`❌ Error syncing balances for item ${plaidItemId}:`, error);
    result.errors.push(error.message || 'Unknown sync error');
    return result;
  }
}
