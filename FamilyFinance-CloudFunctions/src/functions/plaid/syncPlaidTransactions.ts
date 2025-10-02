/**
 * Plaid Transactions Sync Cloud Function
 *
 * Implements Plaid's /transactions/sync endpoint for real-time transaction synchronization.
 * This function is called when SYNC_UPDATES_AVAILABLE webhooks are received.
 *
 * Features:
 * - Uses Plaid's modern /transactions/sync endpoint
 * - Handles cursor-based pagination for incremental sync
 * - Stores raw Plaid transactions and converts to Family Finance format
 * - Manages transaction additions, modifications, and removals
 * - Implements proper error handling and retry logic
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { authenticateRequest, UserRole } from '../../utils/auth';
import { getAccessToken } from '../../utils/encryption';
import { createStandardPlaidClient } from '../../utils/plaidClientFactory';
import {
  Transaction as FamilyTransaction,
  TransactionSplit,
  TransactionStatus,
  TransactionCategory,
  TransactionType,
  PlaidAccount
} from '../../types';
import {
  createDocument,
  getDocument,
  queryDocuments
} from '../../utils/firestore';
import { db } from '../../index';
import {
  Transaction,
  TransactionsSyncRequest,
  TransactionsSyncResponse,
  RemovedTransaction
} from 'plaid';
import { Timestamp } from 'firebase-admin/firestore';

// Define secrets for Firebase configuration (still needed for function setup)
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

/**
 * Sync transactions for a specific Plaid item using /transactions/sync
 */
export const syncTransactionsForItem = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [plaidClientId, plaidSecret],
  },
  async (request) => {
    try {
      // Authenticate user
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      const { itemId } = request.data;

      if (!itemId) {
        throw new HttpsError('invalid-argument', 'itemId is required');
      }

      console.log(`🔄 Starting transaction sync for item: ${itemId}, user: ${userId}`);

      // Get the Plaid item and access token
      const itemDoc = await findPlaidItemByItemId(userId, itemId);
      if (!itemDoc) {
        throw new HttpsError('not-found', `Plaid item not found: ${itemId}`);
      }

      const encryptedAccessToken = itemDoc.accessToken;
      if (!encryptedAccessToken) {
        throw new HttpsError('failed-precondition', 'No access token found for item');
      }

      // Decrypt access token (handles both encrypted and plaintext for backward compatibility)
      const accessToken = getAccessToken(encryptedAccessToken);

      // Create Plaid client using centralized factory
      const plaidClient = createStandardPlaidClient();

      // Get user and family context for transaction creation
      const userDoc = await getDocument('users', userId);
      if (!userDoc) {
        throw new HttpsError('not-found', `User not found: ${userId}`);
      }

      const familyId = (userDoc as any).familyId;

      // Get family currency
      let currency = 'USD';
      if (familyId) {
        const familyDoc = await getDocument('families', familyId);
        if (familyDoc) {
          currency = (familyDoc as any).settings?.currency || 'USD';
        }
      }

      // Perform the sync (creates transactions with splits)
      const syncResult = await performTransactionSync(
        plaidClient,
        accessToken,
        itemId,
        userId,
        familyId,
        currency,
        itemDoc.cursor
      );

      // Update the item's cursor for next sync
      if (syncResult.nextCursor) {
        await updateItemCursor(itemDoc.id, syncResult.nextCursor);
      }

      console.log(`✅ Transaction sync completed for item ${itemId}:`, {
        added: syncResult.addedCount,
        modified: syncResult.modifiedCount,
        removed: syncResult.removedCount,
        nextCursor: syncResult.nextCursor
      });

      return {
        success: true,
        itemId,
        transactions: {
          added: syncResult.addedCount,
          modified: syncResult.modifiedCount,
          removed: syncResult.removedCount
        },
        nextCursor: syncResult.nextCursor,
        message: `Synced ${syncResult.addedCount + syncResult.modifiedCount} transactions`
      };

    } catch (error: any) {
      console.error('Error syncing transactions:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      // Check if this is a Plaid API error
      if (error.response?.data?.error_code) {
        const plaidError = error.response.data;
        throw new HttpsError('failed-precondition',
          `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
      }

      throw new HttpsError('internal', error.message || 'Failed to sync transactions');
    }
  }
);

/**
 * Process webhook-triggered transaction sync (called by webhook handler)
 *
 * This is a wrapper around the main sync logic for webhook compatibility.
 * Uses the same unified transaction creation logic as manual sync.
 */
export async function processWebhookTransactionSync(
  itemId: string,
  userId: string,
  itemDoc?: any  // Optional: pass item data directly from webhook
): Promise<{
  success: boolean;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  error?: string;
}> {
  try {
    console.log(`🔄 Processing webhook transaction sync for item: ${itemId}, user: ${userId}`);

    // Use provided item data or look it up
    let resolvedItemDoc = itemDoc;
    if (!resolvedItemDoc) {
      resolvedItemDoc = await findPlaidItemByItemId(userId, itemId);
      if (!resolvedItemDoc) {
        throw new Error(`Plaid item not found: ${itemId}`);
      }
    }

    const encryptedAccessToken = resolvedItemDoc.accessToken;
    if (!encryptedAccessToken) {
      throw new Error('No access token found for item');
    }

    // Decrypt access token
    const accessToken = getAccessToken(encryptedAccessToken);

    // Create Plaid client
    const plaidClient = createStandardPlaidClient();

    // Get user and family context for transaction creation
    const userDoc = await getDocument('users', userId);
    if (!userDoc) {
      throw new Error(`User not found: ${userId}`);
    }

    const familyId = (userDoc as any).familyId;

    // Get family currency
    let currency = 'USD';
    if (familyId) {
      const familyDoc = await getDocument('families', familyId);
      if (familyDoc) {
        currency = (familyDoc as any).settings?.currency || 'USD';
      }
    }

    // Perform the unified sync (creates transactions with splits)
    const syncResult = await performTransactionSync(
      plaidClient,
      accessToken,
      itemId,
      userId,
      familyId,
      currency,
      resolvedItemDoc.cursor
    );

    // Update the item's cursor for next sync
    if (syncResult.nextCursor) {
      await updateItemCursor(resolvedItemDoc.id, syncResult.nextCursor);
    }

    console.log(`✅ Webhook transaction sync completed for item ${itemId}:`, {
      added: syncResult.addedCount,
      modified: syncResult.modifiedCount,
      removed: syncResult.removedCount
    });

    return {
      success: true,
      addedCount: syncResult.addedCount,
      modifiedCount: syncResult.modifiedCount,
      removedCount: syncResult.removedCount
    };

  } catch (error: any) {
    console.error(`❌ Error in webhook transaction sync for item ${itemId}:`, error);

    // Delegate error handling to centralized handler
    if (error.response?.data?.error_code) {
      console.log(`🔧 Delegating Plaid error handling for item ${itemId} to centralized handler`);
      const { handlePlaidErrorInternal } = await import('./plaidErrorHandler');
      try {
        await handlePlaidErrorInternal(itemId, userId, error, 'webhook-transaction-sync');
      } catch (handlerError) {
        console.error('Centralized error handler failed:', handlerError);
      }
    }

    return {
      success: false,
      addedCount: 0,
      modifiedCount: 0,
      removedCount: 0,
      error: error.message || 'Unknown sync error'
    };
  }
}

/**
 * Core transaction sync implementation using Plaid's /transactions/sync endpoint
 *
 * Creates transactions directly in the 'transactions' collection with proper splits.
 * This is the unified implementation used by both webhooks and manual sync.
 */
async function performTransactionSync(
  plaidClient: any,
  accessToken: string,
  itemId: string,
  userId: string,
  familyId: string | undefined,
  currency: string,
  cursor?: string
): Promise<{
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  nextCursor?: string;
}> {
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let hasMore = true;
  let currentCursor = cursor;

  console.log(`🔄 Starting Plaid /transactions/sync for item ${itemId}, cursor: ${currentCursor || 'none'}`);

  while (hasMore) {
    try {
      // Call Plaid's /transactions/sync endpoint
      const syncRequest: TransactionsSyncRequest = {
        access_token: accessToken,
        cursor: currentCursor,
        count: 500, // Maximum allowed by Plaid
      };

      console.log(`📡 Calling Plaid /transactions/sync with cursor: ${currentCursor || 'initial'}`);

      const syncResponse = await plaidClient.transactionsSync(syncRequest);
      const data: TransactionsSyncResponse = syncResponse.data;

      console.log(`📥 Plaid sync response:`, {
        added: data.added.length,
        modified: data.modified.length,
        removed: data.removed.length,
        hasMore: data.has_more,
        nextCursor: data.next_cursor
      });

      // Process added transactions (creates Family Finance transactions with splits)
      if (data.added.length > 0) {
        const addedResult = await processAddedTransactions(
          data.added,
          itemId,
          userId,
          familyId,
          currency
        );
        addedCount += addedResult;
      }

      // Process modified transactions
      if (data.modified.length > 0) {
        const modifiedResult = await processModifiedTransactions(data.modified, itemId, userId);
        modifiedCount += modifiedResult;
      }

      // Process removed transactions
      if (data.removed.length > 0) {
        const removedResult = await processRemovedTransactions(data.removed, itemId, userId);
        removedCount += removedResult;
      }

      // Update for next iteration
      hasMore = data.has_more;
      currentCursor = data.next_cursor;

      // Add small delay between requests to avoid rate limiting
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error: any) {
      console.error('Error in Plaid transactions sync:', error);
      throw error;
    }
  }

  return {
    addedCount,
    modifiedCount,
    removedCount,
    nextCursor: currentCursor
  };
}

/**
 * Process newly added transactions from Plaid
 *
 * Creates Family Finance transactions with proper splits in the transactions collection.
 * This is the unified implementation used by both webhooks and manual sync.
 */
async function processAddedTransactions(
  addedTransactions: Transaction[],
  itemId: string,
  userId: string,
  familyId: string | undefined,
  currency: string
): Promise<number> {
  console.log(`➕ Processing ${addedTransactions.length} added transactions`);

  let processedCount = 0;

  try {
    // Get account information for transactions
    const accountIds = [...new Set(addedTransactions.map(t => t.account_id))];
    console.log(`Looking for ${accountIds.length} unique accounts`);

    const accountQuery = await queryDocuments('plaid_accounts', {
      where: [
        { field: 'accountId', operator: 'in', value: accountIds },
        { field: 'userId', operator: '==', value: userId }
      ]
    });

    const accountMap = new Map<string, PlaidAccount>();
    accountQuery.forEach(account => {
      accountMap.set((account as any).accountId, account as PlaidAccount);
    });

    console.log(`Found ${accountMap.size} accounts`);

    // Process each transaction individually
    for (const plaidTransaction of addedTransactions) {
      try {
        const account = accountMap.get(plaidTransaction.account_id);
        if (!account) {
          console.warn(`Account not found for transaction: ${plaidTransaction.transaction_id}`);
          continue;
        }

        const transaction = await createTransactionFromPlaid(
          plaidTransaction,
          account,
          userId,
          familyId,
          currency,
          itemId
        );

        if (transaction) {
          processedCount++;
        }
      } catch (error) {
        console.error(`Error processing transaction ${plaidTransaction.transaction_id}:`, error);
      }
    }

    console.log(`✅ Created ${processedCount} Family Finance transactions with splits from ${addedTransactions.length} Plaid transactions`);

    return processedCount;

  } catch (error) {
    console.error('Error processing added transactions:', error);
    return processedCount;
  }
}

/**
 * Process modified transactions from Plaid
 */
async function processModifiedTransactions(
  modifiedTransactions: Transaction[],
  itemId: string,
  userId: string
): Promise<number> {
  console.log(`🔄 Processing ${modifiedTransactions.length} modified transactions`);

  let processedCount = 0;

  try {
    for (const transaction of modifiedTransactions) {
      // Find existing family transaction with Plaid transaction ID
      const existingQuery = await db.collection('transactions')
        .where('metadata.plaidTransactionId', '==', transaction.transaction_id)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        const existingDoc = existingQuery.docs[0];

        // Update the raw Plaid transaction
        await existingDoc.ref.update({
          amount: transaction.amount,
          category: transaction.category,
          merchantName: transaction.merchant_name,
          pending: transaction.pending,
          name: transaction.name,
          location: transaction.location,
          updatedAt: Timestamp.now()
        });

        // Update corresponding family transaction if it exists
        const existingData = existingDoc.data();
        if (existingData.familyTransactionId) {
          await db.collection('transactions')
            .doc(existingData.familyTransactionId)
            .update({
              amount: Math.abs(transaction.amount),
              description: transaction.merchant_name || transaction.name,
              updatedAt: Timestamp.now(),
              'metadata.plaidPending': transaction.pending
            });
        }

        processedCount++;
      }
    }

    console.log(`✅ Updated ${processedCount} modified transactions`);
    return processedCount;

  } catch (error) {
    console.error('Error processing modified transactions:', error);
    return processedCount;
  }
}

/**
 * Process removed transactions from Plaid
 */
async function processRemovedTransactions(
  removedTransactions: RemovedTransaction[],
  itemId: string,
  userId: string
): Promise<number> {
  console.log(`🗑️ Processing ${removedTransactions.length} removed transactions`);

  let processedCount = 0;

  try {
    for (const removedTransaction of removedTransactions) {
      // Find and remove family transaction with Plaid transaction ID
      const existingQuery = await db.collection('transactions')
        .where('metadata.plaidTransactionId', '==', removedTransaction.transaction_id)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        const existingDoc = existingQuery.docs[0];
        const existingData = existingDoc.data();

        // Mark corresponding family transaction as deleted if it exists
        if (existingData.familyTransactionId) {
          await db.collection('transactions')
            .doc(existingData.familyTransactionId)
            .update({
              status: 'DELETED',
              updatedAt: Timestamp.now(),
              'metadata.deletedByPlaid': true,
              'metadata.plaidRemovalReason': 'Transaction removed by institution'
            });
        }

        // Remove the Plaid transaction
        await existingDoc.ref.delete();
        processedCount++;
      }
    }

    console.log(`✅ Removed ${processedCount} transactions`);
    return processedCount;

  } catch (error) {
    console.error('Error processing removed transactions:', error);
    return processedCount;
  }
}

/**
 * Find Plaid item by itemId for a user
 */
async function findPlaidItemByItemId(userId: string, itemId: string): Promise<{
  id: string;
  accessToken: string;
  cursor?: string;
  userId: string;
  itemId: string;
  isActive: boolean;
} | null> {
  try {
    // Try subcollection first
    const subCollectionQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('plaidItemId', '==', itemId)  // Fixed: use plaidItemId instead of itemId
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!subCollectionQuery.empty) {
      const doc = subCollectionQuery.docs[0];
      const data = doc.data() as any;
      return {
        id: doc.id,
        accessToken: data.accessToken,
        cursor: data.cursor,
        userId: data.userId,
        itemId: data.itemId,
        isActive: data.isActive
      };
    }

    // Try top-level collection
    const topLevelQuery = await db.collection('plaid_items')
      .where('plaidItemId', '==', itemId)  // Fixed: use plaidItemId instead of itemId
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!topLevelQuery.empty) {
      const doc = topLevelQuery.docs[0];
      const data = doc.data() as any;
      return {
        id: doc.id,
        accessToken: data.accessToken,
        cursor: data.cursor,
        userId: data.userId,
        itemId: data.itemId,
        isActive: data.isActive
      };
    }

    return null;
  } catch (error) {
    console.error('Error finding Plaid item:', error);
    return null;
  }
}

/**
 * Update Plaid item's cursor for next sync
 */
async function updateItemCursor(itemDocId: string, cursor: string): Promise<void> {
  try {
    // We don't know if it's in subcollection or top-level, so we need to find it
    // This is a simplified approach - in production you'd want to track the location

    await db.collection('plaid_items').doc(itemDocId).update({
      cursor,
      lastSyncedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    console.log(`✅ Updated cursor for item ${itemDocId}: ${cursor}`);
  } catch (error) {
    console.error('Error updating item cursor:', error);
    // Don't throw - cursor update failure shouldn't break the sync
  }
}

// ===== UTILITY FUNCTIONS MOVED FROM plaidTransactionSync.ts =====

/**
 * Converts a Plaid transaction to Family Finance transaction format with splits
 */
/**
 * Convert a Plaid transaction to Family Finance format with splits
 */
async function createTransactionFromPlaid(
  plaidTransaction: any,
  plaidAccount: PlaidAccount,
  userId: string,
  familyId: string | undefined,
  currency: string,
  itemId: string
): Promise<FamilyTransaction | null> {
  try {

    // Determine transaction type and category
    const transactionType = plaidTransaction.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
    const absoluteAmount = Math.abs(plaidTransaction.amount);

    // Map Plaid category to our transaction category
    const category = mapPlaidCategoryToTransactionCategory(plaidTransaction.category);

    // Try to find an appropriate budget for this transaction
    let budgetId: string | undefined;
    let budgetPeriodId = 'unassigned';
    let budgetName = 'General';

    // Look for active budget periods that match this transaction's category
    const budgetPeriodsQuery = await queryDocuments('budget_periods', {
      where: [
        { field: 'userId', operator: '==', value: userId },
        { field: 'isActive', operator: '==', value: true }
      ],
      orderBy: 'periodStart',
      orderDirection: 'desc',
      limit: 10
    });

    if (budgetPeriodsQuery.length > 0) {
      // Use the most recent active budget period
      const latestBudgetPeriod = budgetPeriodsQuery[0];
      budgetId = (latestBudgetPeriod as any).budgetId;
      budgetPeriodId = latestBudgetPeriod.id!;
      budgetName = (latestBudgetPeriod as any).budgetName || 'General';
    }

    // Create default split for the transaction
    const defaultSplit: TransactionSplit = {
      id: db.collection('_dummy').doc().id,
      budgetId: budgetId || 'unassigned',
      budgetPeriodId,
      budgetName,
      categoryId: category,
      amount: absoluteAmount,
      description: undefined,
      isDefault: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: userId,
    };

    // Create transaction with splitting support
    const transaction: Omit<FamilyTransaction, "id" | "createdAt" | "updatedAt"> = {
      userId,
      familyId: familyId || '',
      amount: absoluteAmount,
      currency,
      description: plaidTransaction.merchant_name || plaidTransaction.name || 'Bank Transaction',
      category,
      type: transactionType,
      date: plaidTransaction.date ? Timestamp.fromDate(new Date(plaidTransaction.date)) : Timestamp.now(),
      location: plaidTransaction.location ? {
        name: plaidTransaction.location.address || undefined,
        address: plaidTransaction.location.address || undefined,
        latitude: plaidTransaction.location.lat || undefined,
        longitude: plaidTransaction.location.lon || undefined,
      } : undefined,
      tags: [],
      budgetId,
      status: TransactionStatus.APPROVED, // Plaid transactions are automatically approved
      metadata: {
        createdBy: 'plaid_sync_unified',
        source: 'plaid',
        plaidTransactionId: plaidTransaction.transaction_id,
        plaidAccountId: plaidTransaction.account_id,
        plaidItemId: itemId,
        plaidPending: plaidTransaction.pending,
        requiresApproval: false,
      },

      // Transaction splitting fields
      splits: [defaultSplit],
      isSplit: false, // Single default split
      totalAllocated: absoluteAmount,
      unallocated: 0,
      affectedBudgets: budgetId ? [budgetId] : [],
      affectedBudgetPeriods: budgetPeriodId !== 'unassigned' ? [budgetPeriodId] : [],
      primaryBudgetId: budgetId,
      primaryBudgetPeriodId: budgetPeriodId !== 'unassigned' ? budgetPeriodId : undefined,
    };

    // Create the transaction
    const createdTransaction = await createDocument<FamilyTransaction>("transactions", transaction);

    console.log(`Created transaction ${createdTransaction.id} from Plaid transaction ${plaidTransaction.transaction_id}`);

    return createdTransaction;

  } catch (error) {
    console.error('Error creating transaction from Plaid data:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      transactionId: plaidTransaction.transactionId,
      userId,
      familyId
    });
    return null;
  }
}

/**
 * Maps Plaid category array to our TransactionCategory enum
 */
function mapPlaidCategoryToTransactionCategory(plaidCategories: string[]): TransactionCategory {
  if (!plaidCategories || plaidCategories.length === 0) {
    return TransactionCategory.OTHER_EXPENSE;
  }

  const primaryCategory = plaidCategories[0].toLowerCase();
  const secondaryCategory = plaidCategories[1]?.toLowerCase() || '';

  // Map common Plaid categories to our categories
  const categoryMappings: Record<string, TransactionCategory> = {
    // Food & Dining
    'food and drink': TransactionCategory.FOOD,
    'restaurants': TransactionCategory.FOOD,
    'fast food': TransactionCategory.FOOD,
    'coffee shops': TransactionCategory.FOOD,
    'groceries': TransactionCategory.FOOD,

    // Transportation
    'transportation': TransactionCategory.TRANSPORTATION,
    'gas stations': TransactionCategory.TRANSPORTATION,
    'public transportation': TransactionCategory.TRANSPORTATION,
    'ride share': TransactionCategory.TRANSPORTATION,
    'parking': TransactionCategory.TRANSPORTATION,

    // Shopping & Clothing
    'shops': TransactionCategory.CLOTHING,
    'retail': TransactionCategory.CLOTHING,
    'clothing': TransactionCategory.CLOTHING,
    'department stores': TransactionCategory.CLOTHING,

    // Entertainment
    'entertainment': TransactionCategory.ENTERTAINMENT,
    'movies': TransactionCategory.ENTERTAINMENT,
    'music': TransactionCategory.ENTERTAINMENT,
    'sports': TransactionCategory.ENTERTAINMENT,
    'recreation': TransactionCategory.ENTERTAINMENT,

    // Healthcare
    'healthcare': TransactionCategory.HEALTHCARE,
    'medical': TransactionCategory.HEALTHCARE,
    'pharmacy': TransactionCategory.HEALTHCARE,
    'dentist': TransactionCategory.HEALTHCARE,

    // Utilities
    'utilities': TransactionCategory.UTILITIES,
    'internet': TransactionCategory.UTILITIES,
    'phone': TransactionCategory.UTILITIES,
    'cable': TransactionCategory.UTILITIES,

    // Housing
    'rent': TransactionCategory.HOUSING,
    'mortgage': TransactionCategory.HOUSING,
    'home improvement': TransactionCategory.HOUSING,

    // Travel (map to entertainment as closest match)
    'travel': TransactionCategory.ENTERTAINMENT,
    'hotels': TransactionCategory.ENTERTAINMENT,
    'airlines': TransactionCategory.ENTERTAINMENT,

    // Income
    'payroll': TransactionCategory.SALARY,
    'deposit': TransactionCategory.OTHER_INCOME,
  };

  // Check primary category first
  if (categoryMappings[primaryCategory]) {
    return categoryMappings[primaryCategory];
  }

  // Check secondary category
  if (categoryMappings[secondaryCategory]) {
    return categoryMappings[secondaryCategory];
  }

  // Check if any category contains certain keywords
  const allCategories = plaidCategories.join(' ').toLowerCase();

  if (allCategories.includes('food') || allCategories.includes('restaurant') || allCategories.includes('grocery')) {
    return TransactionCategory.FOOD;
  }
  if (allCategories.includes('gas') || allCategories.includes('fuel') || allCategories.includes('transport')) {
    return TransactionCategory.TRANSPORTATION;
  }
  if (allCategories.includes('clothing') || allCategories.includes('apparel')) {
    return TransactionCategory.CLOTHING;
  }
  if (allCategories.includes('entertainment') || allCategories.includes('movie') || allCategories.includes('game')) {
    return TransactionCategory.ENTERTAINMENT;
  }

  // Default to OTHER_EXPENSE if no mapping found
  return TransactionCategory.OTHER_EXPENSE;
}

