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
    // === IDENTITY & OWNERSHIP (Query-Critical) ===
    userId,
    groupId: familyId || null,
    accessibleBy: [userId],
    streamId: stream.stream_id,
    itemId: itemId,
    accountId: stream.account_id,

    // === STATUS & CONTROL (Query-Critical) ===
    isActive: stream.is_active,
    status: stream.status as any,
    isUserModified: stream.is_user_modified || false,
    isHidden: false,

    // === DESCRIPTIVE INFO ===
    description: stream.description,
    merchantName: stream.merchant_name || null,

    // === AMOUNTS (Flattened for efficient queries) ===
    averageAmount: Math.abs(stream.average_amount.amount || 0),
    lastAmount: Math.abs(stream.last_amount.amount || 0),
    currency: stream.average_amount.iso_currency_code || 'USD',
    unofficialCurrency: (stream.average_amount as any).unofficial_currency_code || null,

    // === DATES & FREQUENCY (Query-Critical) ===
    frequency: stream.frequency as any,
    firstDate: Timestamp.fromDate(new Date(stream.first_date)),
    lastDate: Timestamp.fromDate(new Date(stream.last_date)),
    predictedNextDate: stream.predicted_next_date
      ? Timestamp.fromDate(new Date(stream.predicted_next_date))
      : null,

    // === CLASSIFICATION ===
    incomeType: 'other' as const,
    isRegularSalary: stream.personal_finance_category?.detailed === 'INCOME_WAGES',

    // === NESTED CATEGORIES (Descriptive metadata) ===
    categories: {
      primary: stream.personal_finance_category?.primary || stream.category?.[0] || 'INCOME',
      detailed: stream.personal_finance_category?.detailed || stream.category?.[1],
      tags: [],
      plaidCategories: stream.category || [],
      plaidCategoryId: (stream as any).category_id || null
    },

    // === NESTED RELATIONSHIPS (Foreign keys & links) ===
    relationships: {
      plaidItemId: itemId,
      plaidAccountId: stream.account_id,
      transactionIds: stream.transaction_ids || []
    },

    // === NESTED METADATA (Sync & audit trail) ===
    metadata: {
      source: 'plaid' as const,
      createdBy: userId,
      lastSyncedAt: Timestamp.now(),
      plaidConfidenceLevel: stream.personal_finance_category?.confidence_level || null
    }
  }));
}
