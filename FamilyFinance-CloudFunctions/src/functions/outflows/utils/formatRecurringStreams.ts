/**
 * Format Recurring Streams Utility
 *
 * Pure Plaid → Internal format mapping for recurring transaction streams.
 * This is Step 1 in the recurring transaction pipeline.
 *
 * Takes raw Plaid recurring stream data and converts it to our internal
 * inflow/outflow structure with all required fields.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { TransactionStream } from 'plaid';

/**
 * Format Plaid inflow streams to internal Inflow documents
 *
 * Pure mapping function - no business logic, just structure conversion
 *
 * @param inflowStreams - Raw Plaid inflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted inflow documents ready for transformation
 */
export async function formatInflowStreams(
  inflowStreams: TransactionStream[],
  itemId: string,
  userId: string,
  familyId?: string
): Promise<any[]> {
  console.log(`[formatInflowStreams] Formatting ${inflowStreams.length} inflow streams`);

  return inflowStreams.map(stream => ({
    // === QUERY-CRITICAL FIELDS AT ROOT ===
    userId,
    groupId: familyId,
    accessibleBy: [userId],
    streamId: stream.stream_id,
    itemId: itemId,
    accountId: stream.account_id,
    isActive: stream.is_active,
    status: stream.status as any,

    // === NESTED ACCESS CONTROL ===
    access: {
      ownerId: userId,
      createdBy: userId,
      sharedWith: [],
      visibility: 'private' as const,
      permissions: {}
    },

    // === NESTED CATEGORIES ===
    categories: {
      primary: stream.category?.[0] || 'other',
      secondary: stream.category?.[1],
      tags: []
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
      plaidPersonalFinanceCategory: stream.personal_finance_category ? {
        primary: stream.personal_finance_category.primary,
        detailed: stream.personal_finance_category.detailed,
        confidenceLevel: stream.personal_finance_category.confidence_level || undefined
      } : undefined
    },

    // === NESTED RELATIONSHIPS ===
    relationships: {
      parentId: itemId,
      parentType: 'plaid_item' as const,
      linkedIds: [],
      relatedDocs: []
    },

    // === INFLOW-SPECIFIC FIELDS ===
    description: stream.description,
    merchantName: stream.merchant_name || undefined,
    averageAmount: {
      amount: stream.average_amount.amount || 0,
      isoCurrencyCode: stream.average_amount.iso_currency_code || undefined
    },
    lastAmount: {
      amount: stream.last_amount.amount || 0,
      isoCurrencyCode: stream.last_amount.iso_currency_code || undefined
    },
    frequency: stream.frequency as any,
    firstDate: Timestamp.fromDate(new Date(stream.first_date)),
    lastDate: Timestamp.fromDate(new Date(stream.last_date)),
    predictedNextDate: stream.predicted_next_date
      ? Timestamp.fromDate(new Date(stream.predicted_next_date))
      : undefined,
    isHidden: false,
    incomeType: 'other' as const,
    isRegularSalary: false
  }));
}

/**
 * Format Plaid outflow streams to internal Outflow documents
 *
 * Pure mapping function - no business logic, just structure conversion
 *
 * @param outflowStreams - Raw Plaid outflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted outflow documents ready for transformation
 */
export async function formatOutflowStreams(
  outflowStreams: TransactionStream[],
  itemId: string,
  userId: string,
  familyId?: string
): Promise<any[]> {
  console.log(`[formatOutflowStreams] Formatting ${outflowStreams.length} outflow streams`);

  return outflowStreams.map(stream => ({
    // === QUERY-CRITICAL FIELDS AT ROOT ===
    userId,
    groupId: familyId,
    accessibleBy: [userId],
    streamId: stream.stream_id,
    itemId: itemId,
    accountId: stream.account_id,
    isActive: stream.is_active,
    status: stream.status as any,

    // === NESTED ACCESS CONTROL ===
    access: {
      ownerId: userId,
      createdBy: userId,
      sharedWith: [],
      visibility: 'private' as const,
      permissions: {}
    },

    // === NESTED CATEGORIES ===
    categories: {
      primary: stream.category?.[0] || 'other',
      secondary: stream.category?.[1],
      tags: []
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
      plaidPersonalFinanceCategory: stream.personal_finance_category ? {
        primary: stream.personal_finance_category.primary,
        detailed: stream.personal_finance_category.detailed,
        confidenceLevel: stream.personal_finance_category.confidence_level || undefined
      } : undefined
    },

    // === NESTED RELATIONSHIPS ===
    relationships: {
      parentId: itemId,
      parentType: 'plaid_item' as const,
      linkedIds: [],
      relatedDocs: []
    },

    // === OUTFLOW-SPECIFIC FIELDS ===
    description: stream.description,
    merchantName: stream.merchant_name || undefined,
    averageAmount: {
      amount: stream.average_amount.amount || 0,
      isoCurrencyCode: stream.average_amount.iso_currency_code || undefined
    },
    lastAmount: {
      amount: stream.last_amount.amount || 0,
      isoCurrencyCode: stream.last_amount.iso_currency_code || undefined
    },
    frequency: stream.frequency as any,
    firstDate: Timestamp.fromDate(new Date(stream.first_date)),
    lastDate: Timestamp.fromDate(new Date(stream.last_date)),
    predictedNextDate: stream.predicted_next_date
      ? Timestamp.fromDate(new Date(stream.predicted_next_date))
      : undefined,
    isHidden: false,
    expenseType: 'other' as const,
    isEssential: false
  }));
}
