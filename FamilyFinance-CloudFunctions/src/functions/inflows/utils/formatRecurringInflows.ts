/**
 * Format Recurring Inflows Utility - FLAT STRUCTURE
 *
 * Pure Plaid → Internal format mapping for recurring inflow (income) streams.
 * This is Step 1 in the recurring inflow pipeline.
 *
 * Takes raw Plaid inflow stream data and converts it to our internal
 * FLAT inflow structure with ALL required fields from Plaid API.
 *
 * UPDATED: Now produces FLAT structure with all fields at root level.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { TransactionStream } from 'plaid';
import { Inflow } from '../../../types';

/**
 * Format Plaid inflow streams to internal Inflow documents (FLAT STRUCTURE)
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param inflowStreams - Raw Plaid inflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of formatted flat inflow documents ready for Firestore
 */
export async function formatRecurringInflows(
  inflowStreams: TransactionStream[],
  itemId: string,
  userId: string,
  familyId?: string
): Promise<Partial<Inflow>[]> {
  console.log(`[formatRecurringInflows] Formatting ${inflowStreams.length} inflow streams (FLAT STRUCTURE)`);

  const now = Timestamp.now();

  return inflowStreams.map(stream => ({
    // === DOCUMENT IDENTITY ===
    id: stream.stream_id, // Plaid stream_id as Firestore document ID

    // === OWNERSHIP & ACCESS (Query-Critical) ===
    ownerId: userId, // Using ownerId instead of userId for consistency
    createdBy: userId,
    updatedBy: userId,
    groupId: familyId || null,

    // === PLAID IDENTIFIERS ===
    plaidItemId: itemId,
    accountId: stream.account_id,

    // === FINANCIAL DATA ===
    lastAmount: Math.abs(stream.last_amount.amount || 0),
    averageAmount: Math.abs(stream.average_amount.amount || 0),
    currency: stream.average_amount.iso_currency_code || 'USD',
    unofficialCurrency: (stream.average_amount as any).unofficial_currency_code || null,

    // === DESCRIPTIVE INFO ===
    description: stream.description || null,
    merchantName: stream.merchant_name || null,
    userCustomName: null, // User hasn't set a custom name yet

    // === TEMPORAL DATA ===
    frequency: stream.frequency as any,
    firstDate: Timestamp.fromDate(new Date(stream.first_date)),
    lastDate: Timestamp.fromDate(new Date(stream.last_date)),
    predictedNextDate: stream.predicted_next_date
      ? Timestamp.fromDate(new Date(stream.predicted_next_date))
      : null,

    // === CATEGORIZATION (Flat fields from Plaid) ===
    plaidPrimaryCategory: stream.personal_finance_category?.primary || stream.category?.[0] || 'INCOME',
    plaidDetailedCategory: stream.personal_finance_category?.detailed || stream.category?.[1] || '',
    plaidCategoryId: (stream as any).category_id || null,
    internalPrimaryCategory: null, // User hasn't overridden yet
    internalDetailedCategory: null, // User hasn't overridden yet

    // === INCOME CLASSIFICATION ===
    incomeType: stream.personal_finance_category?.detailed === 'INCOME_WAGES' ? 'salary' : 'other',
    isRegularSalary: stream.personal_finance_category?.detailed === 'INCOME_WAGES',

    // === STATUS & CONTROL ===
    source: 'plaid' as const,
    isActive: stream.is_active,
    isHidden: false, // Default to visible
    isUserModified: stream.is_user_modified || false,
    plaidStatus: stream.status as any,
    plaidConfidenceLevel: stream.personal_finance_category?.confidence_level || null,

    // === TRANSACTION REFERENCES ===
    transactionIds: stream.transaction_ids || [],

    // === USER INTERACTION ===
    tags: [],
    rules: [],

    // === AUDIT TRAIL ===
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: now
  }));
}
