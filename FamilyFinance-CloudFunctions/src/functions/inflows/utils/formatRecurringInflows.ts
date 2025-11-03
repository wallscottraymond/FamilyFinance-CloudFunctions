/**
 * Format Recurring Inflows Utility
 *
 * Pure Plaid → Internal format mapping for recurring inflow (income) streams.
 * This is Step 1 in the recurring inflow pipeline.
 *
 * Takes raw Plaid inflow stream data and converts it to our internal
 * inflow structure with ALL required fields from Plaid API.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { TransactionStream } from 'plaid';

/**
 * Format Plaid inflow streams to internal Inflow documents
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param inflowStreams - Raw Plaid inflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted inflow documents ready for transformation
 */
export async function formatRecurringInflows(
  inflowStreams: TransactionStream[],
  itemId: string,
  userId: string,
  familyId?: string
): Promise<any[]> {
  console.log(`[formatRecurringInflows] Formatting ${inflowStreams.length} inflow streams`);

  return inflowStreams.map(stream => ({
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
      primary: stream.personal_finance_category?.primary || stream.category?.[0] || 'INCOME',
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

    // === INFLOW-SPECIFIC FIELDS (ALL from Plaid API) ===
    description: stream.description,
    merchantName: stream.merchant_name || null,

    // Amount fields with full currency support
    averageAmount: {
      amount: Math.abs(stream.average_amount.amount || 0), // Inflows should be positive
      isoCurrencyCode: stream.average_amount.iso_currency_code || null,
      unofficialCurrencyCode: (stream.average_amount as any).unofficial_currency_code || null
    },
    lastAmount: {
      amount: Math.abs(stream.last_amount.amount || 0), // Inflows should be positive
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
    incomeType: 'other' as const,
    isRegularSalary: stream.personal_finance_category?.detailed === 'INCOME_WAGES'
  }));
}
