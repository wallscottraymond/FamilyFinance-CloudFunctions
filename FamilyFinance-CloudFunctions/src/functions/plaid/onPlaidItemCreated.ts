/**
 * Plaid Item Created Trigger
 *
 * Firestore trigger that automatically runs when a new plaid_item is created.
 * Orchestrates the complete Plaid data synchronization workflow:
 * 1. Sync account balances
 * 2. Sync transactions (with splits)
 * 3. Sync recurring transactions (inflow/outflow)
 *
 * This ensures all Plaid data is consistently synchronized whenever a user
 * links a new bank account.
 *
 * Memory: 1GiB, Timeout: 540s (9 minutes)
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { syncBalances } from './syncBalances';
import { syncTransactions } from './syncTransactions';
import { syncRecurringTransactions } from './syncRecurringTransactions';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
const tokenEncryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

/**
 * Firestore trigger on plaid_items/{itemDocId}
 *
 * Automatically syncs all Plaid data when a new item is created
 */
export const onPlaidItemCreated = onDocumentCreated(
  {
    document: 'plaid_items/{itemDocId}',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (event) => {
    const itemDocId = event.params.itemDocId;
    const itemData = event.data?.data();

    if (!itemData) {
      console.error('No data found in plaid_item document');
      return;
    }

    const plaidItemId = itemData.plaidItemId;
    const userId = itemData.userId;

    console.log(`🎯 Plaid item created trigger fired for item ${plaidItemId}, user ${userId}`);

    try {
      // Step 1: Sync account balances
      console.log('📊 Step 1: Syncing account balances...');
      const balancesResult = await syncBalances(plaidItemId, userId);
      console.log('✅ Balances synced:', balancesResult);

      // Step 2: Sync transactions to transactions collection with splits
      console.log('💳 Step 2: Syncing transactions...');
      const transactionsResult = await syncTransactions(plaidItemId, userId);
      console.log('✅ Transactions synced:', transactionsResult);

      // Step 3: Sync recurring transactions to inflow/outflow collections
      console.log('🔄 Step 3: Syncing recurring transactions...');
      const recurringResult = await syncRecurringTransactions(plaidItemId, userId);
      console.log('✅ Recurring transactions synced:', recurringResult);

      console.log(`🎉 Complete sync finished for item ${plaidItemId}:`, {
        accounts: balancesResult.accountsUpdated,
        transactions: transactionsResult.transactionsCreated,
        recurringInflows: recurringResult.inflowsCreated,
        recurringOutflows: recurringResult.outflowsCreated
      });

    } catch (error) {
      console.error(`❌ Error during Plaid item sync for ${plaidItemId}:`, error);

      // Update the item with error status (optional - for debugging)
      try {
        const { db } = await import('../../index');
        await db.collection('plaid_items').doc(itemDocId).update({
          lastSyncError: error instanceof Error ? error.message : 'Unknown error',
          lastSyncErrorAt: new Date()
        });
      } catch (updateError) {
        console.error('Failed to update item with error status:', updateError);
      }
    }
  }
);
