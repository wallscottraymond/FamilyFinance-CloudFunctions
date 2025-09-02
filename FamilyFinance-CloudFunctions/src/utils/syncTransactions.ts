/**
 * 🚀 UNIFIED TRANSACTION SYNC ENGINE
 * 
 * This is the single source of truth for syncing Plaid transactions to Family Finance format.
 * Used by both:
 * - Initial account linking (exchangePlaidToken.ts)
 * - Webhook updates (plaidWebhook.ts)
 * 
 * 🎯 SIMPLIFIED FLOW:
 * 1. Fetch transactions from Plaid using itemId + accessToken
 * 2. Map each Plaid transaction directly to Family Finance format
 * 3. Create simple single split per transaction
 * 4. Store directly in 'transactions' collection
 * 
 * 💡 BENEFITS:
 * - Single function for all transaction syncing
 * - No redundant plaid_transactions collection
 * - Direct Plaid → Family Finance mapping
 * - Comprehensive error logging
 */

import { PlaidApi, TransactionsGetRequest } from 'plaid';
import * as admin from 'firebase-admin';
import { 
  Transaction, 
  TransactionSplit, 
  TransactionStatus,
  TransactionCategory,
  TransactionType 
} from '../types';
import { createDocument, queryDocuments, getDocument } from './firestore';

export interface SyncResult {
  itemId: string;
  userId: string;
  totalTransactions: number;
  successfullyProcessed: number;
  failed: number;
  errors: string[];
  transactionsByAccount: Record<string, number>;
  processingTimeMs: number;
}

/**
 * 🎯 MAIN SYNC FUNCTION: Unified Transaction Synchronization
 * 
 * Fetches and processes Plaid transactions directly into Family Finance format
 * with single splits. Used by both initial linking and webhook updates.
 * 
 * @param plaidClient - Authenticated Plaid API client
 * @param itemId - Plaid item ID
 * @param accessToken - Plaid access token
 * @param userId - Family Finance user ID
 * @param dateRange - Optional date range (defaults to last 30 days)
 * @returns Complete sync statistics and error details
 */
export async function syncTransactions(
  plaidClient: PlaidApi,
  itemId: string,
  accessToken: string,
  userId: string,
  dateRange?: { startDate: Date; endDate: Date }
): Promise<SyncResult> {
  const startTime = Date.now();
  
  console.log(`🚀 Starting unified transaction sync for item ${itemId}, user ${userId}`);
  
  const result: SyncResult = {
    itemId,
    userId,
    totalTransactions: 0,
    successfullyProcessed: 0,
    failed: 0,
    errors: [],
    transactionsByAccount: {},
    processingTimeMs: 0
  };

  try {
    // 📅 STEP 1: Configure date range
    const endDate = dateRange?.endDate || new Date();
    const startDate = dateRange?.startDate || (() => {
      const date = new Date();
      date.setDate(date.getDate() - 30); // Default: last 30 days
      return date;
    })();

    console.log(`📅 Fetching transactions for date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // 🌐 STEP 2: Fetch transactions from Plaid
    const transactionsRequest: TransactionsGetRequest = {
      access_token: accessToken,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
    };

    console.log(`📞 Calling Plaid transactionsGet API for item ${itemId}`);
    const transactionsResponse = await plaidClient.transactionsGet(transactionsRequest);
    const plaidTransactions = transactionsResponse.data.transactions;

    console.log(`✅ Retrieved ${plaidTransactions.length} transactions from Plaid`);
    result.totalTransactions = plaidTransactions.length;

    if (plaidTransactions.length === 0) {
      console.log(`ℹ️ No transactions found for the specified date range`);
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    // 📊 Count transactions by account
    for (const transaction of plaidTransactions) {
      const accountId = transaction.account_id;
      result.transactionsByAccount[accountId] = (result.transactionsByAccount[accountId] || 0) + 1;
    }

    console.log(`📈 Transaction distribution:`, result.transactionsByAccount);

    // 👤 STEP 3: Get user and family context
    console.log(`👤 Fetching user context for ${userId}`);
    const userDoc = await getDocument('users', userId);
    if (!userDoc) {
      const error = `User document not found: ${userId}`;
      console.error(`❌ ${error}`);
      result.errors.push(error);
      result.failed = result.totalTransactions;
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    const familyId = (userDoc as any).familyId;
    console.log(`👨‍👩‍👧‍👦 User family ID: ${familyId || 'none'}`);

    // 🏦 STEP 4: Get family settings for currency
    let currency = 'USD'; // Default
    if (familyId) {
      console.log(`💰 Fetching family currency settings`);
      const familyDoc = await getDocument('families', familyId);
      if (familyDoc) {
        currency = (familyDoc as any).settings?.currency || 'USD';
        console.log(`💰 Family currency: ${currency}`);
      } else {
        console.warn(`⚠️ Family document not found: ${familyId}, using default currency: ${currency}`);
      }
    }

    // 🔄 STEP 5: Process each transaction
    console.log(`🔄 Processing ${plaidTransactions.length} transactions...`);
    
    for (let i = 0; i < plaidTransactions.length; i++) {
      const plaidTransaction = plaidTransactions[i];
      
      try {
        console.log(`📝 Processing transaction ${i + 1}/${plaidTransactions.length}: ${plaidTransaction.transaction_id}`);
        console.log(`   💰 Amount: ${plaidTransaction.amount}, Merchant: ${plaidTransaction.merchant_name || plaidTransaction.name}`);
        
        await processIndividualTransaction(
          plaidTransaction,
          userId,
          familyId,
          currency
        );
        
        result.successfullyProcessed++;
        console.log(`   ✅ Successfully processed transaction ${plaidTransaction.transaction_id}`);
        
      } catch (error) {
        result.failed++;
        const errorMsg = `Failed to process transaction ${plaidTransaction.transaction_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        
        console.error(`   ❌ ${errorMsg}`);
        console.error(`   🔍 Transaction details:`, {
          transactionId: plaidTransaction.transaction_id,
          amount: plaidTransaction.amount,
          merchant: plaidTransaction.merchant_name,
          category: plaidTransaction.category,
          error: error instanceof Error ? error.stack : error
        });
      }
    }

    result.processingTimeMs = Date.now() - startTime;

    console.log(`🎯 Sync completed for item ${itemId}:`, {
      totalTransactions: result.totalTransactions,
      successful: result.successfullyProcessed,
      failed: result.failed,
      errors: result.errors.length,
      processingTimeMs: result.processingTimeMs
    });

    return result;

  } catch (error) {
    result.processingTimeMs = Date.now() - startTime;
    const errorMsg = `Critical error in syncTransactions: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errors.push(errorMsg);
    result.failed = result.totalTransactions;

    console.error(`🚨 ${errorMsg}`);
    console.error(`🔍 Critical error details:`, {
      itemId,
      userId,
      error: error instanceof Error ? error.stack : error,
      processingTimeMs: result.processingTimeMs
    });

    return result;
  }
}

/**
 * 🔄 Process Individual Transaction
 * 
 * Converts a single Plaid transaction to Family Finance format with simple split
 */
async function processIndividualTransaction(
  plaidTransaction: any,
  userId: string,
  familyId: string | undefined,
  currency: string
): Promise<void> {
  console.log(`    🔄 Converting Plaid transaction to Family Finance format`);

  // 💰 Determine transaction type and amount
  const isExpense = plaidTransaction.amount > 0;
  const absoluteAmount = Math.abs(plaidTransaction.amount);
  const transactionType = isExpense ? TransactionType.EXPENSE : TransactionType.INCOME;

  console.log(`    📊 Transaction type: ${transactionType}, Amount: ${absoluteAmount} ${currency}`);

  // 📂 Map Plaid category to Family Finance category
  const familyFinanceCategory = mapPlaidCategoryToFamilyFinance(plaidTransaction.category || []);
  console.log(`    📂 Category mapping: ${JSON.stringify(plaidTransaction.category)} → ${familyFinanceCategory}`);

  // 🎯 Find active budget for this user
  console.log(`    🎯 Looking for active budget periods`);
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
      console.log(`    🎯 Found active budget: ${budgetName} (${budgetId})`);
    } else {
      console.log(`    ⚠️ No active budget periods found, using defaults`);
    }
  } catch (error) {
    console.error(`    ❌ Error finding budget periods: ${error}`);
  }

  // 📋 Create single split (simplified structure)
  const split: TransactionSplit = {
    id: admin.firestore().collection('_dummy').doc().id,
    budgetId: budgetId || 'unassigned',
    budgetPeriodId,
    budgetName,
    categoryId: familyFinanceCategory,
    amount: absoluteAmount,
    description: `Split for ${plaidTransaction.merchant_name || plaidTransaction.name}`,
    isDefault: true,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    createdBy: userId,
  };

  console.log(`    📋 Created split:`, {
    splitId: split.id,
    category: split.categoryId,
    amount: split.amount,
    budget: split.budgetName
  });

  // 🏗️ Build complete Family Finance transaction
  const transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
    userId,
    familyId: familyId || '',
    amount: absoluteAmount,
    currency,
    description: plaidTransaction.merchant_name || plaidTransaction.name || 'Bank Transaction',
    category: familyFinanceCategory,
    type: transactionType,
    date: admin.firestore.Timestamp.fromDate(new Date(plaidTransaction.date)),
    location: plaidTransaction.location ? {
      name: plaidTransaction.location.address || plaidTransaction.merchant_name,
      address: plaidTransaction.location.address,
      latitude: plaidTransaction.location.lat,
      longitude: plaidTransaction.location.lon,
    } : undefined,
    tags: [],
    budgetId,
    status: TransactionStatus.APPROVED,
    metadata: {
      createdBy: 'plaid_sync_unified',
      source: 'plaid',
      plaidTransactionId: plaidTransaction.transaction_id,
      plaidAccountId: plaidTransaction.account_id,
      plaidCategory: plaidTransaction.category,
      plaidMerchant: plaidTransaction.merchant_name,
      originalDescription: plaidTransaction.name,
      requiresApproval: false,
    },
    
    // 🎯 SPLITS STRUCTURE (simplified)
    splits: [split],
    isSplit: false, // Single split = not a split transaction
    totalAllocated: absoluteAmount,
    unallocated: 0,
    affectedBudgets: budgetId ? [budgetId] : [],
    affectedBudgetPeriods: budgetPeriodId !== 'unassigned' ? [budgetPeriodId] : [],
    primaryBudgetId: budgetId,
    primaryBudgetPeriodId: budgetPeriodId !== 'unassigned' ? budgetPeriodId : undefined,
  };

  console.log(`    🏗️ Built transaction:`, {
    amount: transaction.amount,
    type: transaction.type,
    category: transaction.category,
    splitsCount: transaction.splits.length,
    totalAllocated: transaction.totalAllocated
  });

  // 💾 Save to transactions collection
  console.log(`    💾 Saving to transactions collection`);
  const createdTransaction = await createDocument<Transaction>("transactions", transaction);
  
  console.log(`    ✅ Created Family Finance transaction: ${createdTransaction.id}`);
}

/**
 * 🏷️ Map Plaid Categories to Family Finance Categories
 * 
 * Simple mapping from Plaid's category hierarchy to our enum
 */
function mapPlaidCategoryToFamilyFinance(plaidCategories: string[]): TransactionCategory {
  if (!plaidCategories || plaidCategories.length === 0) {
    console.log(`    📂 No category provided, defaulting to OTHER_EXPENSE`);
    return TransactionCategory.OTHER_EXPENSE;
  }

  const primaryCategory = plaidCategories[0]?.toLowerCase() || '';
  const secondaryCategory = plaidCategories[1]?.toLowerCase() || '';

  console.log(`    📂 Mapping categories: [${plaidCategories.join(', ')}]`);

  // Category mapping with logging
  const categoryMappings: Record<string, TransactionCategory> = {
    'food and drink': TransactionCategory.FOOD,
    'restaurants': TransactionCategory.FOOD,
    'groceries': TransactionCategory.FOOD,
    'transportation': TransactionCategory.TRANSPORTATION,
    'gas stations': TransactionCategory.TRANSPORTATION,
    'shops': TransactionCategory.CLOTHING,
    'retail': TransactionCategory.CLOTHING,
    'entertainment': TransactionCategory.ENTERTAINMENT,
    'utilities': TransactionCategory.UTILITIES,
    'healthcare': TransactionCategory.HEALTHCARE,
    'housing': TransactionCategory.HOUSING,
    'rent': TransactionCategory.HOUSING,
    'mortgage': TransactionCategory.HOUSING,
    'payroll': TransactionCategory.SALARY,
    'deposit': TransactionCategory.OTHER_INCOME,
  };

  for (const [key, category] of Object.entries(categoryMappings)) {
    if (primaryCategory.includes(key) || secondaryCategory.includes(key)) {
      console.log(`    📂 Matched '${key}' → ${category}`);
      return category;
    }
  }

  console.log(`    📂 No mapping found, defaulting to OTHER_EXPENSE`);
  return TransactionCategory.OTHER_EXPENSE;
}