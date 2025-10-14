/**
 * Transaction Formatting Utilities
 *
 * This module handles all transaction formatting logic, including:
 * - Orchestrating batch transaction processing
 * - Category mapping from Plaid categories
 * - Budget period matching based on transaction date
 * - Transaction splitting setup
 * - Metadata preparation
 * - Firestore document creation
 *
 * Separates data transformation from data fetching for better maintainability.
 */

import { Timestamp, FieldPath } from 'firebase-admin/firestore';
import { db } from '../../../index';
import {
  Transaction as FamilyTransaction,
  TransactionSplit,
  TransactionStatus,
  TransactionCategory,
  TransactionType,
  PlaidAccount
} from '../../../types';
import { queryDocuments, createDocument } from '../../../utils/firestore';
import { Transaction as PlaidTransaction } from 'plaid';

/**
 * Format and create transactions from Plaid sync data
 *
 * Orchestrates the full transaction processing flow:
 * 1. Fetch account information
 * 2. Format each transaction
 * 3. Create documents in Firestore
 *
 * @param addedTransactions - Raw transactions from Plaid
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID
 * @param currency - Currency code
 * @returns Count of successfully processed transactions
 */
export async function formatTransactions(
  addedTransactions: PlaidTransaction[],
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

    const accountQuery = await queryDocuments('accounts', {
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

        // Build the transaction data
        const formattedTransaction = await buildTransactionData(
          plaidTransaction,
          account,
          userId,
          familyId,
          currency,
          itemId
        );

        // Create the transaction in Firestore
        if (formattedTransaction) {
          const createdTransaction = await createDocument<FamilyTransaction>(
            "transactions",
            formattedTransaction,
            plaidTransaction.transaction_id
          );

          if (createdTransaction) {
            console.log(`Created transaction ${createdTransaction.id} from Plaid transaction ${plaidTransaction.transaction_id}`);
            processedCount++;
          }
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
 * Align transaction categories based on additional business logic
 *
 * This function can be called after formatTransactions to apply:
 * - Merchant name lookups in categories collection
 * - Transaction name keyword matching
 * - User-specific category rules
 * - Family-level category preferences
 *
 * @param transactionIds - Array of transaction IDs to realign
 * @param userId - User ID
 * @returns Count of successfully realigned transactions
 */
export async function alignTransactionCategories(
  transactionIds: string[],
  userId: string
): Promise<number> {
  console.log(`🔄 Aligning categories for ${transactionIds.length} transactions`);

  let alignedCount = 0;

  try {
    // Fetch transactions from Firestore
    const transactionsSnapshot = await db.collection('transactions')
      .where(FieldPath.documentId(), 'in', transactionIds)
      .where('userId', '==', userId)
      .get();

    console.log(`📊 Found ${transactionsSnapshot.size} transactions to align`);

    for (const transactionDoc of transactionsSnapshot.docs) {
      try {
        const transaction = transactionDoc.data() as FamilyTransaction;

        // Only realign if currently OTHER_EXPENSE or unassigned
        if (transaction.category !== TransactionCategory.OTHER_EXPENSE) {
          console.log(`  ⏭️ Skipping transaction ${transactionDoc.id} - already has category ${transaction.category}`);
          continue;
        }

        // Extract merchant and transaction name from metadata
        const merchantName = transaction.metadata?.plaidMerchantName;
        const transactionName = transaction.metadata?.plaidName;

        let newCategory: TransactionCategory | null = null;

        // Try merchant name lookup
        if (merchantName) {
          newCategory = await lookupCategoryByMerchant(merchantName);
          if (newCategory) {
            console.log(`  ✅ Realigned ${transactionDoc.id} via merchant "${merchantName}" → ${newCategory}`);
          }
        }

        // Try transaction name lookup if merchant didn't match
        if (!newCategory && transactionName) {
          newCategory = await lookupCategoryByTransactionName(transactionName);
          if (newCategory) {
            console.log(`  ✅ Realigned ${transactionDoc.id} via name "${transactionName}" → ${newCategory}`);
          }
        }

        // Update transaction if new category found
        if (newCategory) {
          await transactionDoc.ref.update({
            category: newCategory,
            updatedAt: Timestamp.now(),
            'metadata.categoryAlignedAt': Timestamp.now(),
            'metadata.categoryAlignedBy': 'alignTransactionCategories'
          });

          // Also update the category in splits
          const updatedSplits = transaction.splits.map(split => ({
            ...split,
            categoryId: newCategory,
            updatedAt: Timestamp.now()
          }));

          await transactionDoc.ref.update({
            splits: updatedSplits
          });

          alignedCount++;
        }
      } catch (error) {
        console.error(`Error aligning transaction ${transactionDoc.id}:`, error);
      }
    }

    console.log(`✅ Aligned ${alignedCount} transaction categories out of ${transactionIds.length}`);

    return alignedCount;

  } catch (error) {
    console.error('Error in alignTransactionCategories:', error);
    return alignedCount;
  }
}

/**
 * Look up category by merchant name in the categories collection
 */
async function lookupCategoryByMerchant(merchantName: string): Promise<TransactionCategory | null> {
  try {
    console.log(`  🔍 Looking up merchant in categories collection: "${merchantName}"`);

    // Query categories collection for matching merchant
    const categoriesSnapshot = await db.collection('categories')
      .where('merchants', 'array-contains', merchantName.toLowerCase())
      .limit(1)
      .get();

    if (!categoriesSnapshot.empty) {
      const categoryDoc = categoriesSnapshot.docs[0];
      const categoryId = categoryDoc.id as TransactionCategory;
      return categoryId;
    }

    return null;
  } catch (error) {
    console.error('Error looking up category by merchant:', error);
    return null;
  }
}

/**
 * Look up category by transaction name in the categories collection
 */
async function lookupCategoryByTransactionName(transactionName: string): Promise<TransactionCategory | null> {
  try {
    console.log(`  🔍 Looking up transaction name in categories collection: "${transactionName}"`);

    // Query categories collection for matching keywords in transaction name
    const categoriesSnapshot = await db.collection('categories').get();

    for (const doc of categoriesSnapshot.docs) {
      const categoryData = doc.data();
      const keywords = categoryData.keywords || [];

      // Check if any keyword matches the transaction name
      const nameMatch = keywords.some((keyword: string) =>
        transactionName.toLowerCase().includes(keyword.toLowerCase())
      );

      if (nameMatch) {
        const categoryId = doc.id as TransactionCategory;
        console.log(`  ✅ Found match via keywords in category: ${categoryId}`);
        return categoryId;
      }
    }

    return null;
  } catch (error) {
    console.error('Error looking up category by transaction name:', error);
    return null;
  }
}

/**
 * Build transaction data from Plaid transaction
 *
 * @param plaidTransaction - Raw transaction data from Plaid
 * @param plaidAccount - Account information
 * @param userId - User ID
 * @param familyId - Family ID
 * @param currency - Currency code
 * @param itemId - Plaid item ID
 * @returns Formatted transaction ready for Firestore, or null if formatting fails
 */
async function buildTransactionData(
  plaidTransaction: any,
  plaidAccount: PlaidAccount,
  userId: string,
  familyId: string | undefined,
  currency: string,
  itemId: string
): Promise<FamilyTransaction | null> {
  try {
    // Determine transaction type and amount
    const transactionType = plaidTransaction.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
    const absoluteAmount = Math.abs(plaidTransaction.amount);

    // Extract category from Plaid's new personal_finance_category format
    // Use detailed category directly (uppercase snake_case) as the category ID
    let category: string;

    if (plaidTransaction.personal_finance_category?.detailed) {
      // Use Plaid's detailed category directly (e.g., "FOOD_AND_DRINK_RESTAURANTS")
      category = plaidTransaction.personal_finance_category.detailed;
      console.log(`🏷️ Using Plaid detailed category for transaction ${plaidTransaction.transaction_id}: ${category}`);
    } else if (plaidTransaction.personal_finance_category?.primary) {
      // Fallback to primary category (e.g., "FOOD_AND_DRINK")
      category = plaidTransaction.personal_finance_category.primary;
      console.log(`🏷️ Using Plaid primary category for transaction ${plaidTransaction.transaction_id}: ${category}`);
    } else {
      // Legacy format or no category - default to OTHER_EXPENSE
      category = TransactionCategory.OTHER_EXPENSE;
      console.log(`⚠️ No Plaid personal_finance_category for transaction ${plaidTransaction.transaction_id}, defaulting to: ${category}`);
    }

    // Match transaction to budget period
    const budgetMatch = await matchTransactionToBudgetPeriod(
      userId,
      plaidTransaction.date ? new Date(plaidTransaction.date) : new Date()
    );

    // Extract primary and detailed categories from Plaid
    const categoryPrimary = plaidTransaction.personal_finance_category?.primary;
    const categoryDetailed = plaidTransaction.personal_finance_category?.detailed;

    // Create default split for the transaction
    const defaultSplit: TransactionSplit = {
      id: db.collection('_dummy').doc().id,
      budgetId: budgetMatch.budgetId || 'unassigned',
      budgetPeriodId: budgetMatch.budgetPeriodId,
      budgetName: budgetMatch.budgetName,
      categoryId: category,
      category: categoryDetailed,        // Plaid detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
      categoryPrimary: categoryPrimary,  // Plaid primary category (e.g., "FOOD_AND_DRINK")
      amount: absoluteAmount,
      description: undefined,
      isDefault: true,

      // Initialize new fields with default values
      ignore: false,
      return: false,
      deductible: false,
      note: undefined,
      billId: undefined,
      billName: undefined,

      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: userId,
    };

    // Build the formatted transaction
    const transaction: Omit<FamilyTransaction, "id" | "createdAt" | "updatedAt"> = {
      userId,
      familyId: familyId || '',
      amount: absoluteAmount,
      currency,
      description: plaidTransaction.merchant_name || plaidTransaction.name || 'Bank Transaction',
      category,
      type: transactionType,
      date: plaidTransaction.date
        ? Timestamp.fromDate(new Date(plaidTransaction.date))
        : Timestamp.now(),
      location: plaidTransaction.location ? {
        name: plaidTransaction.location.address || undefined,
        address: plaidTransaction.location.address || undefined,
        latitude: plaidTransaction.location.lat || undefined,
        longitude: plaidTransaction.location.lon || undefined,
      } : undefined,
      tags: [],
      budgetId: budgetMatch.budgetId,
      status: TransactionStatus.APPROVED, // Plaid transactions are automatically approved
      metadata: {
        createdBy: 'plaid_sync_unified',
        source: 'plaid',
        plaidTransactionId: plaidTransaction.transaction_id,
        plaidAccountId: plaidTransaction.account_id,
        plaidItemId: itemId,
        plaidPending: plaidTransaction.pending,
        plaidCategory: plaidTransaction.category || [], // Save Plaid categories for reprocessing
        plaidMerchantName: plaidTransaction.merchant_name,
        plaidName: plaidTransaction.name,
        requiresApproval: false,
      },

      // Transaction splitting fields
      splits: [defaultSplit],
      isSplit: false, // Single default split
      totalAllocated: absoluteAmount,
      unallocated: 0,
      affectedBudgets: budgetMatch.budgetId ? [budgetMatch.budgetId] : [],
      affectedBudgetPeriods: budgetMatch.budgetPeriodId !== 'unassigned' ? [budgetMatch.budgetPeriodId] : [],
      primaryBudgetId: budgetMatch.budgetId,
      primaryBudgetPeriodId: budgetMatch.budgetPeriodId !== 'unassigned' ? budgetMatch.budgetPeriodId : undefined,
    };

    return transaction as FamilyTransaction;

  } catch (error) {
    console.error('Error formatting transaction from Plaid data:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      transactionId: plaidTransaction.transaction_id,
      userId,
      familyId
    });
    return null;
  }
}

/**
 * Match a transaction to a budget period based on its date
 *
 * @param userId - User ID
 * @param transactionDate - Date of the transaction
 * @returns Budget match information (budgetId, budgetPeriodId, budgetName)
 */
export async function matchTransactionToBudgetPeriod(
  userId: string,
  transactionDate: Date
): Promise<{
  budgetId: string | undefined;
  budgetPeriodId: string;
  budgetName: string;
}> {
  const transactionTimestamp = Timestamp.fromDate(transactionDate);

  console.log(`🔍 Looking for budget periods for user ${userId}, transaction date: ${transactionDate.toISOString()}`);

  // Query all active budget periods for the user
  const budgetPeriodsQuery = await queryDocuments('budget_periods', {
    where: [
      { field: 'userId', operator: '==', value: userId },
      { field: 'isActive', operator: '==', value: true }
    ]
  });

  console.log(`📊 Found ${budgetPeriodsQuery.length} active budget periods for user`);

  // Filter to find budget period that contains the transaction date
  for (const period of budgetPeriodsQuery) {
    const periodData = period as any;
    const periodStart = periodData.periodStartDate || periodData.periodStart;
    const periodEnd = periodData.periodEndDate || periodData.periodEnd;

    console.log(`  📅 Checking period ${period.id}: start=${periodStart}, end=${periodEnd}`);

    if (periodStart && periodEnd) {
      const startTimestamp = periodStart instanceof Timestamp
        ? periodStart
        : Timestamp.fromDate(new Date(periodStart));
      const endTimestamp = periodEnd instanceof Timestamp
        ? periodEnd
        : Timestamp.fromDate(new Date(periodEnd));

      console.log(`  ⏰ Period range: ${startTimestamp.toDate().toISOString()} to ${endTimestamp.toDate().toISOString()}`);
      console.log(`  🎯 Transaction timestamp: ${transactionTimestamp.toDate().toISOString()}`);
      console.log(`  ✔️ In range? ${transactionTimestamp.toMillis() >= startTimestamp.toMillis() && transactionTimestamp.toMillis() <= endTimestamp.toMillis()}`);

      // Check if transaction date falls within this period
      if (transactionTimestamp.toMillis() >= startTimestamp.toMillis() &&
          transactionTimestamp.toMillis() <= endTimestamp.toMillis()) {
        console.log(`  🎉 MATCH! Using period ${period.id} (${periodData.budgetName})`);

        return {
          budgetId: periodData.budgetId,
          budgetPeriodId: period.id!,
          budgetName: periodData.budgetName || 'General'
        };
      }
    }
  }

  console.log(`⚠️ No matching budget period found for transaction dated ${transactionDate.toISOString()}`);

  return {
    budgetId: undefined,
    budgetPeriodId: 'unassigned',
    budgetName: 'General'
  };
}

