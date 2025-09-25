/**
 * Plaid Transaction Synchronization with Splits Support
 * 
 * This utility handles the creation of Family Finance transactions from Plaid data,
 * ensuring each transaction is created with proper splits structure for consistency
 * with manual transactions.
 * 
 * Features:
 * - Converts Plaid transactions to Family Finance format
 * - Creates default splits for all transactions
 * - Handles budget period assignment when available
 * - Maintains data consistency across sync operations
 * - Includes proper error handling and logging
 */

import * as admin from 'firebase-admin';
import { 
  Transaction, 
  TransactionSplit, 
  TransactionStatus,
  TransactionCategory,
  TransactionType,
  PlaidTransaction,
  PlaidAccount
} from '../types';
import { 
  createDocument, 
  updateDocument, 
  getDocument,
  queryDocuments 
} from './firestore';

/**
 * Converts a Plaid transaction to Family Finance transaction format with splits
 */
export async function createTransactionFromPlaid(
  plaidTransaction: PlaidTransaction,
  plaidAccount: PlaidAccount,
  userId: string,
  familyId?: string
): Promise<Transaction | null> {
  try {
    // Get user document to determine family and settings
    const userDoc = await getDocument('users', userId);
    if (!userDoc) {
      console.error(`User not found: ${userId}`);
      return null;
    }

    const userFamilyId = familyId || (userDoc as any).familyId;
    if (!userFamilyId) {
      console.error(`User ${userId} has no family association`);
      return null;
    }

    // Get family settings for currency
    const familyDoc = await getDocument('families', userFamilyId);
    if (!familyDoc) {
      console.error(`Family not found: ${userFamilyId}`);
      return null;
    }

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
      id: admin.firestore().collection('_dummy').doc().id,
      budgetId: budgetId || 'unassigned',
      budgetPeriodId,
      budgetName,
      categoryId: category,
      amount: absoluteAmount,
      description: undefined,
      isDefault: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      createdBy: userId,
    };

    // Create transaction with splitting support
    const transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
      userId,
      familyId: userFamilyId,
      amount: absoluteAmount,
      currency: (familyDoc as any).settings?.currency || 'USD',
      description: plaidTransaction.merchantName || 'Bank Transaction',
      category,
      type: transactionType,
      date: plaidTransaction.dateTransacted || admin.firestore.Timestamp.now(),
      location: plaidTransaction.location ? {
        name: plaidTransaction.location.address || undefined,
        address: plaidTransaction.location.address || undefined,
        latitude: plaidTransaction.location.lat || undefined,
        longitude: plaidTransaction.location.lon || undefined,
      } : undefined,
      tags: plaidTransaction.tags || [],
      budgetId,
      status: TransactionStatus.APPROVED, // Plaid transactions are automatically approved
      metadata: {
        createdBy: 'plaid_sync',
        source: 'plaid',
        plaidTransactionId: plaidTransaction.transactionId,
        plaidAccountId: plaidTransaction.accountId,
        plaidItemId: plaidTransaction.itemId,
        plaidPending: plaidTransaction.pending,
        requiresApproval: false,
      },
      
      // New splitting fields
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
    const createdTransaction = await createDocument<Transaction>("transactions", transaction);
    
    console.log(`Created transaction ${createdTransaction.id} from Plaid transaction ${plaidTransaction.transactionId}`);
    
    // Mark the Plaid transaction as processed
    await updatePlaidTransactionProcessed(plaidTransaction.transactionId, createdTransaction.id!);
    
    return createdTransaction;

  } catch (error) {
    console.error('Error creating transaction from Plaid:', error);
    console.error('Transaction creation error details:', {
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
    'electronics': TransactionCategory.OTHER_EXPENSE,
    'general merchandise': TransactionCategory.OTHER_EXPENSE,
    
    // Entertainment
    'entertainment': TransactionCategory.ENTERTAINMENT,
    'movies': TransactionCategory.ENTERTAINMENT,
    'music': TransactionCategory.ENTERTAINMENT,
    'games': TransactionCategory.ENTERTAINMENT,
    
    // Bills & Utilities
    'payment': TransactionCategory.UTILITIES,
    'utilities': TransactionCategory.UTILITIES,
    'telecommunication services': TransactionCategory.UTILITIES,
    'internet': TransactionCategory.UTILITIES,
    'cable': TransactionCategory.UTILITIES,
    
    // Healthcare
    'healthcare': TransactionCategory.HEALTHCARE,
    'medical': TransactionCategory.HEALTHCARE,
    'pharmacy': TransactionCategory.HEALTHCARE,
    'dental': TransactionCategory.HEALTHCARE,
    
    // Housing
    'housing': TransactionCategory.HOUSING,
    'rent': TransactionCategory.HOUSING,
    'mortgage': TransactionCategory.HOUSING,
    
    // Financial
    'bank': TransactionCategory.OTHER_EXPENSE,
    'credit card': TransactionCategory.DEBT_PAYMENT,
    'loan': TransactionCategory.DEBT_PAYMENT,
    'transfer': TransactionCategory.OTHER_EXPENSE,
    
    // Income
    'payroll': TransactionCategory.SALARY,
    'deposit': TransactionCategory.OTHER_INCOME,
  };

  // Try to find a mapping
  for (const [key, category] of Object.entries(categoryMappings)) {
    if (primaryCategory.includes(key) || secondaryCategory.includes(key)) {
      return category;
    }
  }

  // Default to OTHER_EXPENSE if no mapping found
  return TransactionCategory.OTHER_EXPENSE;
}

/**
 * Updates a Plaid transaction to mark it as processed
 */
async function updatePlaidTransactionProcessed(
  plaidTransactionId: string, 
  familyTransactionId: string
): Promise<void> {
  try {
    const plaidTransactionQuery = await queryDocuments('plaid_transactions', {
      where: [
        { field: 'transactionId', operator: '==', value: plaidTransactionId }
      ],
      limit: 1
    });

    if (plaidTransactionQuery.length > 0) {
      const plaidTransaction = plaidTransactionQuery[0];
      await updateDocument('plaid_transactions', plaidTransaction.id!, {
        isProcessed: true,
        familyTransactionId,
        updatedAt: admin.firestore.Timestamp.now()
      });
    }
  } catch (error) {
    console.error('Error updating Plaid transaction processed status:', error);
  }
}

/**
 * Batch processes multiple Plaid transactions into Family Finance transactions
 */
export async function batchCreateTransactionsFromPlaid(
  plaidTransactions: PlaidTransaction[],
  userId: string,
  familyId?: string
): Promise<{
  successful: number;
  failed: number;
  errors: string[];
}> {
  const results = {
    successful: 0,
    failed: 0,
    errors: [] as string[]
  };

  console.log(`Processing batch of ${plaidTransactions.length} Plaid transactions for user ${userId}`);

  // Get account information for all transactions with retry logic for Firestore consistency
  const accountIds = [...new Set(plaidTransactions.map(t => t.accountId))];
  console.log(`Looking for accounts with IDs: ${accountIds.join(', ')}`);
  
  // Retry logic with exponential backoff for Firestore eventual consistency
  let accountMap = new Map<string, PlaidAccount>();
  let retryCount = 0;
  const maxRetries = 5;
  
  while (retryCount <= maxRetries && accountMap.size === 0) {
    const delay = Math.pow(2, retryCount) * 500; // 500ms, 1s, 2s, 4s, 8s
    
    if (retryCount > 0) {
      console.log(`Retry attempt ${retryCount} after ${delay}ms delay...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const accountQuery = await queryDocuments('plaid_accounts', {
      where: [
        { field: 'accountId', operator: 'in', value: accountIds },
        { field: 'userId', operator: '==', value: userId }
      ]
    });

    console.log(`Found ${accountQuery.length} accounts in plaid_accounts collection (attempt ${retryCount + 1})`);
    
    accountQuery.forEach(account => {
      console.log(`Mapping account: ${(account as any).accountId}`);
      accountMap.set((account as any).accountId, account as PlaidAccount);
    });
    
    retryCount++;
  }
  
  // Final check - if still no accounts found after all retries
  if (accountMap.size === 0) {
    console.error(`No accounts found for user ${userId} after ${maxRetries} retries. Expected account IDs: ${accountIds.join(', ')}`);
    return {
      successful: 0,
      failed: plaidTransactions.length,
      errors: [`No accounts found after ${maxRetries} retries. This may indicate a Firestore consistency issue or data corruption.`]
    };
  }
  
  console.log(`Successfully found ${accountMap.size} accounts after ${retryCount} attempts`);

  // Process transactions in batches to avoid overwhelming Firestore
  const BATCH_SIZE = 20;
  for (let i = 0; i < plaidTransactions.length; i += BATCH_SIZE) {
    const batch = plaidTransactions.slice(i, i + BATCH_SIZE);
    
    const batchPromises = batch.map(async (plaidTransaction) => {
      try {
        const account = accountMap.get(plaidTransaction.accountId);
        if (!account) {
          throw new Error(`Account not found: ${plaidTransaction.accountId}`);
        }

        const transaction = await createTransactionFromPlaid(
          plaidTransaction,
          account,
          userId,
          familyId
        );

        if (transaction) {
          results.successful++;
        } else {
          results.failed++;
          results.errors.push(`Failed to create transaction for ${plaidTransaction.transactionId}`);
        }
      } catch (error) {
        results.failed++;
        const errorMsg = `Error processing ${plaidTransaction.transactionId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        results.errors.push(errorMsg);
        console.error(`Transaction processing error details:`, {
          transactionId: plaidTransaction.transactionId,
          accountId: plaidTransaction.accountId,
          userId,
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
          fullTransaction: plaidTransaction
        });
      }
    });

    await Promise.allSettled(batchPromises);
    
    // Add small delay between batches to prevent rate limiting
    if (i + BATCH_SIZE < plaidTransactions.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`Batch processing complete: ${results.successful} successful, ${results.failed} failed`);
  
  if (results.errors.length > 0) {
    console.error(`Transaction batch errors (${results.errors.length} total):`, results.errors);
  }
  
  return results;
}

/**
 * Syncs transactions for a specific Plaid item
 */
export async function syncTransactionsForPlaidItem(
  itemId: string,
  userId: string
): Promise<{
  transactionsAdded: number;
  transactionsUpdated: number;
  errors: string[];
}> {
  try {
    console.log(`Starting transaction sync for Plaid item: ${itemId}`);

    // Get unprocessed Plaid transactions for this item
    const unprocessedTransactions = await queryDocuments('plaid_transactions', {
      where: [
        { field: 'itemId', operator: '==', value: itemId },
        { field: 'userId', operator: '==', value: userId },
        { field: 'isProcessed', operator: '==', value: false }
      ],
      orderBy: 'dateTransacted',
      orderDirection: 'desc',
      limit: 100 // Process in chunks
    });

    if (unprocessedTransactions.length === 0) {
      console.log(`No unprocessed transactions found for item: ${itemId}`);
      return {
        transactionsAdded: 0,
        transactionsUpdated: 0,
        errors: []
      };
    }

    // Batch create transactions
    const batchResult = await batchCreateTransactionsFromPlaid(
      unprocessedTransactions as PlaidTransaction[],
      userId
    );

    return {
      transactionsAdded: batchResult.successful,
      transactionsUpdated: 0,
      errors: batchResult.errors
    };

  } catch (error) {
    console.error(`Error syncing transactions for item ${itemId}:`, error);
    return {
      transactionsAdded: 0,
      transactionsUpdated: 0,
      errors: [error instanceof Error ? error.message : 'Unknown sync error']
    };
  }
}