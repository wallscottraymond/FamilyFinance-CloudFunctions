/**
 * Format Recurring Outflows Utility
 *
 * Pure Plaid → Internal format mapping for recurring outflow (expense) streams.
 * This is Step 1 in the recurring outflow pipeline.
 *
 * Takes raw Plaid outflow stream data and converts it to our internal
 * outflow structure with ALL required fields from Plaid API.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { TransactionStream } from 'plaid';

/**
 * Format Plaid outflow streams to internal Outflow documents
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param outflowStreams - Raw Plaid outflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted outflow documents ready for transformation
 */
export async function formatRecurringOutflows(
  outflowStreams: TransactionStream[],
  itemId: string,
  userId: string,
  familyId?: string
): Promise<any[]> {
  console.log(`[formatRecurringOutflows] Formatting ${outflowStreams.length} outflow streams`);

  return outflowStreams.map(stream => ({
    // === QUERY-CRITICAL FIELDS AT ROOT ===
    userId,
    groupId: familyId || null,
    accessibleBy: [userId],
    streamId: stream.stream_id,
    itemId: itemId,
    accountId: stream.account_id,
    isActive: stream.is_active,
    status: stream.status as any,
    isUserModified: stream.is_user_modified || false,

    // === NESTED ACCESS CONTROL ===
    access: {
      ownerId: userId,
      createdBy: userId,
      isPrivate: !familyId
    },

    // === NESTED CATEGORIES ===
    categories: {
      primary: stream.personal_finance_category?.primary || stream.category?.[0] || 'GENERAL_SERVICES',
      secondary: stream.personal_finance_category?.detailed || stream.category?.[1],
      tags: [],
      // Store legacy Plaid category data
      plaidCategories: stream.category || [],
      plaidCategoryId: (stream as any).category_id || null
    },

    // === NESTED METADATA ===
    metadata: {
      source: 'plaid' as const,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: Timestamp.now(),
      version: 1,
      lastSyncedAt: Timestamp.now(),
      syncVersion: 1,
      // Store Plaid personal finance category
      plaidPersonalFinanceCategory: stream.personal_finance_category ? {
        primary: stream.personal_finance_category.primary,
        detailed: stream.personal_finance_category.detailed,
        confidenceLevel: stream.personal_finance_category.confidence_level || null
      } : null
    },

    // === NESTED RELATIONSHIPS ===
    relationships: {
      parentId: itemId,
      parentType: 'plaid_item' as const,
      linkedIds: [],
      relatedDocs: [],
      // Store related transaction IDs from Plaid
      transactionIds: stream.transaction_ids || []
    },

    // === OUTFLOW-SPECIFIC FIELDS (ALL from Plaid API) ===
    description: stream.description,
    merchantName: stream.merchant_name || null,

    // Amount fields with full currency support
    averageAmount: {
      amount: Math.abs(stream.average_amount.amount || 0), // Outflows should be positive
      isoCurrencyCode: stream.average_amount.iso_currency_code || null,
      unofficialCurrencyCode: (stream.average_amount as any).unofficial_currency_code || null
    },
    lastAmount: {
      amount: Math.abs(stream.last_amount.amount || 0), // Outflows should be positive
      isoCurrencyCode: stream.last_amount.iso_currency_code || null,
      unofficialCurrencyCode: (stream.last_amount as any).unofficial_currency_code || null
    },

    // Date and frequency fields
    frequency: stream.frequency as any,
    firstDate: Timestamp.fromDate(new Date(stream.first_date)),
    lastDate: Timestamp.fromDate(new Date(stream.last_date)),
    predictedNextDate: stream.predicted_next_date
      ? Timestamp.fromDate(new Date(stream.predicted_next_date))
      : null,

    // UI and classification fields
    isHidden: false,
    expenseType: determineExpenseType(stream),
    isEssential: isEssentialExpense(stream)
  }));
}

/**
 * Determine expense type based on Plaid category
 */
function determineExpenseType(stream: TransactionStream): 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other' {
  const detailed = stream.personal_finance_category?.detailed?.toUpperCase();

  if (detailed?.includes('UTILITIES') || detailed?.includes('ELECTRIC') || detailed?.includes('GAS') || detailed?.includes('WATER')) {
    return 'utility';
  }
  if (detailed?.includes('RENT') || detailed?.includes('MORTGAGE')) {
    return 'rent';
  }
  if (detailed?.includes('INSURANCE')) {
    return 'insurance';
  }
  if (detailed?.includes('LOAN') || detailed?.includes('CREDIT_CARD_PAYMENT')) {
    return 'loan';
  }
  if (detailed?.includes('TAX')) {
    return 'tax';
  }
  if (stream.frequency === 'MONTHLY' || stream.frequency === 'ANNUALLY') {
    return 'subscription';
  }

  return 'other';
}

/**
 * Determine if expense is essential based on Plaid category
 */
function isEssentialExpense(stream: TransactionStream): boolean {
  const primary = stream.personal_finance_category?.primary?.toUpperCase();
  const detailed = stream.personal_finance_category?.detailed?.toUpperCase();

  const essentialCategories = [
    'RENT',
    'MORTGAGE',
    'UTILITIES',
    'ELECTRIC',
    'GAS',
    'WATER',
    'INSURANCE',
    'LOAN',
    'HEALTHCARE',
    'MEDICAL',
    'PHARMACY',
    'FOOD_AND_DRINK_GROCERIES'
  ];

  return essentialCategories.some(cat =>
    primary?.includes(cat) || detailed?.includes(cat)
  );
}
