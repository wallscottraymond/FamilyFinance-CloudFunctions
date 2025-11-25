/**
 * Format Recurring Outflows Utility - FLAT STRUCTURE
 *
 * Pure Plaid → Internal format mapping for recurring outflow (expense) streams.
 * This is Step 1 in the recurring outflow pipeline.
 *
 * Takes raw Plaid outflow stream data and converts it to our FLAT internal
 * outflow structure with ALL fields at root level (no nested objects).
 *
 * IMPORTANT: This produces the NEW flat structure. Old outflows with nested
 * structure will remain untouched and continue to work.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { TransactionStream } from 'plaid';
import { Outflow } from '../../../types';

/**
 * Format Plaid outflow streams to flat Outflow documents
 *
 * Pure mapping function - no business logic, just structure conversion.
 * Captures ALL fields from Plaid's recurring transactions API response.
 *
 * @param outflowStreams - Raw Plaid outflow streams
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param familyId - Family ID (optional)
 * @returns Array of flat outflow documents ready for Firestore
 */
export async function formatRecurringOutflows(
  outflowStreams: TransactionStream[],
  itemId: string,
  userId: string,
  familyId?: string
): Promise<Outflow[]> {
  console.log(`[formatRecurringOutflows] Formatting ${outflowStreams.length} outflow streams to FLAT structure`);

  return outflowStreams.map(stream => {
    const outflow: Outflow = {
      // === DOCUMENT IDENTITY ===
      id: stream.stream_id,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),

      // === OWNERSHIP & ACCESS ===
      ownerId: userId,
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

      // === DESCRIPTIVE INFO ===
      description: stream.description || null,
      merchantName: stream.merchant_name || null,
      userCustomName: null,  // User hasn't set custom name yet

      // === TEMPORAL DATA ===
      frequency: stream.frequency,
      firstDate: Timestamp.fromDate(new Date(stream.first_date)),
      lastDate: Timestamp.fromDate(new Date(stream.last_date)),
      predictedNextDate: stream.predicted_next_date
        ? Timestamp.fromDate(new Date(stream.predicted_next_date))
        : null,

      // === CATEGORIZATION ===
      plaidPrimaryCategory: stream.personal_finance_category?.primary || stream.category?.[0] || 'GENERAL_SERVICES',
      plaidDetailedCategory: stream.personal_finance_category?.detailed || stream.category?.[1] || '',
      internalPrimaryCategory: null,  // User hasn't overridden yet
      internalDetailedCategory: null,  // User hasn't overridden yet
      type: determineTransactionType(stream),

      // === LEGACY FIELDS (maintained for backward compatibility) ===
      expenseType: determineExpenseType(stream),
      isEssential: isEssentialExpense(stream),

      // === STATUS & CONTROL ===
      source: 'plaid',
      isActive: stream.is_active,
      isHidden: false,
      isUserModified: stream.is_user_modified || false,
      plaidStatus: stream.status,

      // === TRANSACTION REFERENCES ===
      transactionIds: stream.transaction_ids || [],

      // === USER INTERACTION ===
      tags: [],
      rules: []  // Empty array for future use
    };

    return outflow;
  });
}

/**
 * Determine transaction type from Plaid stream
 *
 * @param stream - Plaid transaction stream
 * @returns Transaction type string
 */
function determineTransactionType(stream: TransactionStream): string {
  // Use Plaid's transaction type if available
  if ((stream as any).transaction_type) {
    return (stream as any).transaction_type;
  }

  // Fall back to frequency-based classification
  const freq = stream.frequency?.toUpperCase();
  if (freq === 'MONTHLY' || freq === 'ANNUALLY') {
    return 'subscription';
  }

  return 'recurring';
}

/**
 * Determine expense type based on Plaid category
 *
 * Legacy field maintained for backward compatibility with existing UI/logic.
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
 *
 * Legacy field maintained for backward compatibility with existing UI/logic.
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
