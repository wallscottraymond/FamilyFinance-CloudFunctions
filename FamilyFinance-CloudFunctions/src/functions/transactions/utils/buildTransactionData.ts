/**
 * Transaction Data Builder
 *
 * Transforms raw Plaid transaction data into application transaction format.
 * Implements the 3-step access control pattern for proper group sharing.
 *
 * Responsibilities:
 * - Plaid data extraction and mapping
 * - Category determination
 * - Transaction split creation
 * - Access control enhancement (3-step pattern)
 * - Transaction structure building
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
import {
  Transaction as FamilyTransaction,
  TransactionSplit,
  TransactionStatus,
  TransactionCategory,
  TransactionType,
  PlaidAccount
} from '../../../types';
import {
  buildAccessControl,
  buildTransactionCategories,
  buildMetadata,
  buildRelationships
} from '../../../utils/documentStructure';

/**
 * Build transaction data from Plaid transaction
 *
 * Converts single groupId to groupIds array for new multi-group architecture.
 *
 * @param plaidTransaction - Raw transaction data from Plaid
 * @param plaidAccount - Account information
 * @param userId - User ID
 * @param groupId - Group ID (will be converted to groupIds array)
 * @param currency - Currency code
 * @param itemId - Plaid item ID
 * @returns Formatted transaction ready for Firestore, or null if formatting fails
 */
export async function buildTransactionData(
  plaidTransaction: any,
  plaidAccount: PlaidAccount,
  userId: string,
  groupId: string | undefined,
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

    // Transaction date for payment tracking
    const transactionDate = plaidTransaction.date
      ? Timestamp.fromDate(new Date(plaidTransaction.date))
      : Timestamp.now();

    // Extract primary and detailed categories from Plaid (use null instead of undefined)
    const categoryPrimary = plaidTransaction.personal_finance_category?.primary ?? null;
    const categoryDetailed = plaidTransaction.personal_finance_category?.detailed ?? null;

    // Create default split for the transaction
    // Initialize all matching fields to undefined - they will be populated by matching functions
    const defaultSplit: TransactionSplit = {
      id: db.collection('_dummy').doc().id,
      budgetId: 'unassigned', // Will be updated by matchTransactionSplitsToBudgets
      budgetName: 'General', // Will be updated by matchTransactionSplitsToBudgets
      categoryId: category,
      category: categoryDetailed,        // Plaid detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
      categoryPrimary: categoryPrimary,  // Plaid primary category (e.g., "FOOD_AND_DRINK")
      amount: absoluteAmount,
      description: null,
      isDefault: true,

      // Source period IDs - will be populated by matchTransactionsToPeriods
      monthlyPeriodId: null,
      weeklyPeriodId: null,
      biWeeklyPeriodId: null,

      // Assignment references - will be populated by matchTransactionSplitsToOutflows
      outflowId: undefined,

      // Enhanced status fields (correct naming as per TransactionSplit interface)
      isIgnored: false,
      isRefund: false,
      isTaxDeductible: false,
      ignoredReason: null,
      refundReason: null,
      taxDeductibleCategory: null,

      // Payment tracking
      paymentDate: transactionDate,
      note: null,

      // Audit fields
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: userId,
    };

    // Step 1: Build complete transaction structure
    // Initialize groupId/groupIds as empty - can be populated later by matching function if needed
    const transaction: Omit<FamilyTransaction, "id" | "createdAt" | "updatedAt"> = {
      // === QUERY-CRITICAL FIELDS AT ROOT (with defaults) ===
      userId,
      groupId: null, // Initialize as null - matching function can populate later
      groupIds: [], // Empty array for multi-group support
      accountId: plaidTransaction.account_id,
      amount: absoluteAmount,
      date: plaidTransaction.date
        ? Timestamp.fromDate(new Date(plaidTransaction.date))
        : Timestamp.now(),
      status: TransactionStatus.APPROVED, // Plaid transactions are automatically approved
      isActive: true,

      // === NESTED ACCESS CONTROL OBJECT (with defaults) ===
      access: buildAccessControl(userId, userId, []), // Empty array for groupIds

      // === NESTED CATEGORIES OBJECT ===
      categories: buildTransactionCategories(category, {
        tags: [],
        budgetCategory: undefined, // Will be populated by matchTransactionSplitsToBudgets
        plaidPrimary: categoryPrimary,
        plaidDetailed: categoryDetailed,
        plaidCategories: plaidTransaction.category || []
      }),

      // === NESTED METADATA OBJECT ===
      metadata: buildMetadata(userId, 'plaid', {
        plaidTransactionId: plaidTransaction.transaction_id,
        plaidAccountId: plaidTransaction.account_id,
        plaidItemId: itemId,
        plaidPending: plaidTransaction.pending,
        plaidMerchantName: plaidTransaction.merchant_name,
        plaidName: plaidTransaction.name,
        requiresApproval: false,
        location: plaidTransaction.location ? {
          name: plaidTransaction.location.address || undefined,
          address: plaidTransaction.location.address || undefined,
          latitude: plaidTransaction.location.lat || undefined,
          longitude: plaidTransaction.location.lon || undefined,
        } : undefined,
        plaidData: {
          category: plaidTransaction.category?.join(',') || '',
          detailedCategory: categoryDetailed,
          primaryCategory: categoryPrimary,
          merchantName: plaidTransaction.merchant_name,
          amount: plaidTransaction.amount,
          date: plaidTransaction.date
            ? Timestamp.fromDate(new Date(plaidTransaction.date))
            : Timestamp.now(),
          description: plaidTransaction.name,
          pending: plaidTransaction.pending,
          personalFinanceCategory: plaidTransaction.personal_finance_category ? {
            primary: plaidTransaction.personal_finance_category.primary,
            detailed: plaidTransaction.personal_finance_category.detailed,
            confidenceLevel: plaidTransaction.personal_finance_category.confidence_level
          } : undefined
        },
        // Rule application tracking (initialize as empty)
        appliedRules: [],
        isRuleModified: false,
        lastRuleApplication: undefined,
        ruleApplicationCount: 0,
      }),

      // === NESTED RELATIONSHIPS OBJECT ===
      relationships: {
        ...buildRelationships({
          accountId: plaidTransaction.account_id,
          budgetId: undefined // Will be populated by matchTransactionSplitsToBudgets
        }),
        affectedBudgets: [], // Will be populated by matchTransactionSplitsToBudgets
        affectedBudgetPeriods: [], // Will be populated by matchTransactionsToPeriods
        primaryBudgetId: undefined, // Will be populated by matchTransactionSplitsToBudgets
        primaryBudgetPeriodId: undefined
      },

      // === TRANSACTION-SPECIFIC FIELDS AT ROOT ===
      currency,
      description: plaidTransaction.merchant_name || plaidTransaction.name || 'Bank Transaction',
      type: transactionType,

      // Transaction splitting fields
      splits: [defaultSplit],
      isSplit: false, // Single default split
      totalAllocated: absoluteAmount,
      unallocated: 0,
    };

    // Step 2: Return transaction with null fields - they will be populated by matching functions
    console.log(`✅ [buildTransactionData] Transaction mapped from Plaid:`, {
      transactionId: plaidTransaction.transaction_id,
      userId,
      groupId: null,
      budgetId: null,
      periodsPopulated: false,
      note: 'Matching fields will be populated by sequential processing functions'
    });

    return transaction as FamilyTransaction;

  } catch (error) {
    console.error('Error formatting transaction from Plaid data:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      transactionId: plaidTransaction.transaction_id,
      userId,
      groupId
    });
    return null;
  }
}
