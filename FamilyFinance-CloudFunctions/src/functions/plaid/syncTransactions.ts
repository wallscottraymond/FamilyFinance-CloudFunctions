/**
 * Sync Transactions Function
 *
 * Fetches transactions from Plaid and creates Family Finance transactions
 * with proper splits in the transactions collection.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token and cursor
 * 2. Call Plaid /transactions/sync (modern cursor-based API)
 * 3. Create transactions with splits in transactions collection
 * 4. Update cursor for next sync
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
  TransactionType
} from '../../types';
import {
  createDocument,
  getDocument,
  queryDocuments
} from '../../utils/firestore';
import { db } from '../../index';
import {
  Transaction as PlaidTransaction,
  TransactionsSyncRequest,
  TransactionsSyncResponse,
  RemovedTransaction
} from 'plaid';
import { Timestamp } from 'firebase-admin/firestore';

// Define secrets
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
const tokenEncryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

/**
 * Callable function for manual transaction sync
 */
export const syncTransactionsCallable = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 300,
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

      console.log(`🔄 Manual transaction sync requested for item: ${plaidItemId}, user: ${userId}`);

      const result = await syncTransactions(plaidItemId, userId);

      return {
        success: true,
        ...result
      };

    } catch (error: any) {
      console.error('Error in manual transaction sync:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to sync transactions');
    }
  }
);

/**
 * Internal sync transactions function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID
 * @returns Sync result with transaction counts
 */
export async function syncTransactions(
  plaidItemId: string,
  userId: string
): Promise<{
  transactionsCreated: number;
  transactionsModified: number;
  transactionsRemoved: number;
  errors: string[];
}> {
  console.log(`💳 Starting transaction sync for item ${plaidItemId}, user ${userId}`);

  const result = {
    transactionsCreated: 0,
    transactionsModified: 0,
    transactionsRemoved: 0,
    errors: [] as string[]
  };

  try {
    // Step 1: Find the plaid_item to get access token and cursor
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
    const cursor = itemData.cursor;

    if (!encryptedAccessToken) {
      throw new Error('No access token found for item');
    }

    // Decrypt access token
    const accessToken = getAccessToken(encryptedAccessToken);

    // Step 2: Get user and family context
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

    // Step 3: Call Plaid /transactions/sync
    const plaidClient = createStandardPlaidClient();

    let hasMore = true;
    let currentCursor = cursor;

    console.log(`📡 Starting Plaid /transactions/sync with cursor: ${currentCursor || 'none'}`);

    while (hasMore) {
      const syncRequest: TransactionsSyncRequest = {
        access_token: accessToken,
        cursor: currentCursor,
        count: 500 // Maximum allowed by Plaid
      };

      const syncResponse = await plaidClient.transactionsSync(syncRequest);
      const data: TransactionsSyncResponse = syncResponse.data;

      console.log(`📥 Received: ${data.added.length} added, ${data.modified.length} modified, ${data.removed.length} removed`);

      // Process added transactions
      if (data.added.length > 0) {
        const addedCount = await processAddedTransactions(
          data.added,
          plaidItemId,
          userId,
          familyId,
          currency
        );
        result.transactionsCreated += addedCount;
      }

      // Process modified transactions
      if (data.modified.length > 0) {
        const modifiedCount = await processModifiedTransactions(data.modified, userId);
        result.transactionsModified += modifiedCount;
      }

      // Process removed transactions
      if (data.removed.length > 0) {
        const removedCount = await processRemovedTransactions(data.removed, userId);
        result.transactionsRemoved += removedCount;
      }

      hasMore = data.has_more;
      currentCursor = data.next_cursor;

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
      }
    }

    // Step 4: Update cursor for next sync
    await itemDoc.ref.update({
      cursor: currentCursor,
      lastTransactionSyncedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    console.log(`✅ Transaction sync completed:`, result);

    return result;

  } catch (error: any) {
    console.error(`❌ Error syncing transactions for item ${plaidItemId}:`, error);
    result.errors.push(error.message || 'Unknown sync error');
    return result;
  }
}

/**
 * Process added transactions from Plaid
 */
async function processAddedTransactions(
  addedTransactions: PlaidTransaction[],
  plaidItemId: string,
  userId: string,
  familyId: string | undefined,
  currency: string
): Promise<number> {
  console.log(`➕ Processing ${addedTransactions.length} added transactions`);

  let processedCount = 0;

  try {
    // Get account information
    const accountIds = [...new Set(addedTransactions.map(t => t.account_id))];

    const accountQuery = await db.collection('accounts')
      .where('plaidAccountId', 'in', accountIds)
      .where('userId', '==', userId)
      .get();

    const accountMap = new Map<string, any>();
    accountQuery.forEach(doc => {
      const data = doc.data();
      accountMap.set(data.plaidAccountId, data);
    });

    // Process each transaction
    for (const plaidTxn of addedTransactions) {
      try {
        const account = accountMap.get(plaidTxn.account_id);
        if (!account) {
          console.warn(`Account not found: ${plaidTxn.account_id}`);
          continue;
        }

        await createTransactionFromPlaid(
          plaidTxn,
          plaidItemId,
          userId,
          familyId,
          currency
        );

        processedCount++;
      } catch (error) {
        console.error(`Error processing transaction ${plaidTxn.transaction_id}:`, error);
      }
    }

    return processedCount;

  } catch (error) {
    console.error('Error processing added transactions:', error);
    return processedCount;
  }
}

/**
 * Process modified transactions
 */
async function processModifiedTransactions(
  modifiedTransactions: PlaidTransaction[],
  userId: string
): Promise<number> {
  console.log(`🔄 Processing ${modifiedTransactions.length} modified transactions`);

  let processedCount = 0;

  for (const txn of modifiedTransactions) {
    try {
      const query = await db.collection('transactions')
        .where('metadata.plaidTransactionId', '==', txn.transaction_id)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      if (!query.empty) {
        const doc = query.docs[0];
        const data = doc.data();

        await doc.ref.update({
          amount: Math.abs(txn.amount),
          description: txn.merchant_name || txn.name,
          'metadata.plaidPending': txn.pending,
          updatedAt: Timestamp.now()
        });

        // Update split amount if exists
        if (data.splits && data.splits.length > 0) {
          const updatedSplits = data.splits.map((split: TransactionSplit) => ({
            ...split,
            amount: Math.abs(txn.amount),
            updatedAt: Timestamp.now()
          }));

          await doc.ref.update({
            splits: updatedSplits,
            totalAllocated: Math.abs(txn.amount)
          });
        }

        processedCount++;
      }
    } catch (error) {
      console.error(`Error updating transaction ${txn.transaction_id}:`, error);
    }
  }

  return processedCount;
}

/**
 * Process removed transactions
 */
async function processRemovedTransactions(
  removedTransactions: RemovedTransaction[],
  userId: string
): Promise<number> {
  console.log(`🗑️ Processing ${removedTransactions.length} removed transactions`);

  let processedCount = 0;

  for (const txn of removedTransactions) {
    try {
      const query = await db.collection('transactions')
        .where('metadata.plaidTransactionId', '==', txn.transaction_id)
        .where('userId', '==', userId)
        .limit(1)
        .get();

      if (!query.empty) {
        await query.docs[0].ref.update({
          status: TransactionStatus.CANCELLED,
          'metadata.deletedByPlaid': true,
          updatedAt: Timestamp.now()
        });

        processedCount++;
      }
    } catch (error) {
      console.error(`Error removing transaction ${txn.transaction_id}:`, error);
    }
  }

  return processedCount;
}

/**
 * Create a Family Finance transaction from Plaid data with splits
 */
async function createTransactionFromPlaid(
  plaidTxn: PlaidTransaction,
  plaidItemId: string,
  userId: string,
  familyId: string | undefined,
  currency: string
): Promise<void> {
  const transactionType = plaidTxn.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
  const absoluteAmount = Math.abs(plaidTxn.amount);

  // Map Plaid category
  const category = mapPlaidCategory(plaidTxn.category || []);

  // Find active budget (optional - transactions can exist without budgets)
  let budgetId: string | undefined;
  let budgetPeriodId = 'unassigned';
  let budgetName = 'General';

  try {
    const budgetPeriodsQuery = await queryDocuments('budget_periods', {
      where: [
        { field: 'userId', operator: '==', value: userId },
        { field: 'isActive', operator: '==', value: true }
      ],
      orderBy: 'periodStart',
      orderDirection: 'desc',
      limit: 1
    });

    if (budgetPeriodsQuery.length > 0) {
      const budgetPeriod = budgetPeriodsQuery[0] as any;
      budgetId = budgetPeriod.budgetId;
      budgetPeriodId = budgetPeriod.id;
      budgetName = budgetPeriod.budgetName || 'General';
    }
  } catch (error) {
    // Budget period lookup failed - continue without budget assignment
    console.warn(`Could not find budget period for transaction ${plaidTxn.transaction_id}:`, error);
  }

  // Create default split
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

  // Create transaction
  const transaction: Omit<FamilyTransaction, "id" | "createdAt" | "updatedAt"> = {
    userId,
    familyId: familyId || '',
    accountId: plaidTxn.account_id,
    amount: absoluteAmount,
    currency,
    description: plaidTxn.merchant_name || plaidTxn.name || 'Bank Transaction',
    category,
    type: transactionType,
    date: plaidTxn.date ? Timestamp.fromDate(new Date(plaidTxn.date)) : Timestamp.now(),
    location: plaidTxn.location ? {
      address: plaidTxn.location.address || undefined,
      latitude: plaidTxn.location.lat || undefined,
      longitude: plaidTxn.location.lon || undefined,
    } : undefined,
    tags: [],
    budgetId,
    status: TransactionStatus.APPROVED,
    metadata: {
      createdBy: 'plaid_sync',
      source: 'plaid',
      plaidTransactionId: plaidTxn.transaction_id,
      plaidAccountId: plaidTxn.account_id,
      plaidItemId,
      plaidPending: plaidTxn.pending,
      requiresApproval: false,
    },
    splits: [defaultSplit],
    isSplit: false,
    totalAllocated: absoluteAmount,
    unallocated: 0,
    affectedBudgets: budgetId ? [budgetId] : [],
    affectedBudgetPeriods: budgetPeriodId !== 'unassigned' ? [budgetPeriodId] : [],
    primaryBudgetId: budgetId,
    primaryBudgetPeriodId: budgetPeriodId !== 'unassigned' ? budgetPeriodId : undefined,
  };

  await createDocument<FamilyTransaction>("transactions", transaction);
}

/**
 * Map Plaid categories to Family Finance categories
 */
function mapPlaidCategory(plaidCategories: string[]): TransactionCategory {
  if (!plaidCategories || plaidCategories.length === 0) {
    return TransactionCategory.OTHER_EXPENSE;
  }

  const primary = plaidCategories[0].toLowerCase();
  const secondary = plaidCategories[1]?.toLowerCase() || '';

  const mappings: Record<string, TransactionCategory> = {
    'food and drink': TransactionCategory.FOOD,
    'restaurants': TransactionCategory.FOOD,
    'groceries': TransactionCategory.FOOD,
    'transportation': TransactionCategory.TRANSPORTATION,
    'shops': TransactionCategory.CLOTHING,
    'entertainment': TransactionCategory.ENTERTAINMENT,
    'healthcare': TransactionCategory.HEALTHCARE,
    'utilities': TransactionCategory.UTILITIES,
    'housing': TransactionCategory.HOUSING,
    'rent': TransactionCategory.HOUSING,
    'mortgage': TransactionCategory.HOUSING,
    'payroll': TransactionCategory.SALARY,
    'deposit': TransactionCategory.OTHER_INCOME,
  };

  for (const [key, cat] of Object.entries(mappings)) {
    if (primary.includes(key) || secondary.includes(key)) {
      return cat;
    }
  }

  return TransactionCategory.OTHER_EXPENSE;
}
