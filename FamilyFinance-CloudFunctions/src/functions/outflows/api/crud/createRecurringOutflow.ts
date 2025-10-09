/**
 * Create Recurring Outflow Cloud Function
 *
 * Creates a user-defined recurring outflow (bill) in the outflows collection.
 * Unlike Plaid-synced outflows, these are manually created by users.
 *
 * Once created, the existing infrastructure will automatically generate
 * outflow_periods documents for this recurring bill.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// Initialize Firestore
const db = getFirestore();

/**
 * Request interface for creating a recurring outflow
 */
export interface CreateRecurringOutflowRequest {
  description: string; // Bill name
  merchantName?: string; // Merchant/company name
  amount: number; // Bill amount
  frequency: 'weekly' | 'bi_weekly' | 'monthly' | 'quarterly' | 'yearly';
  expenseType?: 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other';
  isEssential?: boolean; // Whether this is an essential expense
  dueDay?: number; // Day of month when bill is due (for monthly bills)
  userNotes?: string; // User notes
  familyId?: string; // Optional family association
}

/**
 * Response interface for create recurring outflow
 */
export interface CreateRecurringOutflowResponse {
  success: boolean;
  outflowId?: string;
  message?: string;
}

/**
 * Convert frontend frequency to Plaid frequency enum for consistency
 */
function mapFrequencyToPlaidFormat(frequency: string): string {
  const frequencyMap: { [key: string]: string } = {
    'weekly': 'WEEKLY',
    'bi_weekly': 'BIWEEKLY',
    'monthly': 'MONTHLY',
    'quarterly': 'QUARTERLY',
    'yearly': 'ANNUALLY',
  };
  return frequencyMap[frequency] || 'MONTHLY';
}

/**
 * Calculate next due date based on frequency and due day
 */
function calculateNextDueDate(frequency: string, dueDay?: number): Timestamp {
  const now = new Date();
  let nextDate = new Date();

  switch (frequency) {
    case 'weekly':
      nextDate.setDate(now.getDate() + 7);
      break;
    case 'bi_weekly':
      nextDate.setDate(now.getDate() + 14);
      break;
    case 'monthly':
      if (dueDay && dueDay >= 1 && dueDay <= 31) {
        nextDate.setDate(dueDay);
        // If the due day has passed this month, move to next month
        if (nextDate <= now) {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }
      } else {
        nextDate.setMonth(now.getMonth() + 1);
      }
      break;
    case 'quarterly':
      nextDate.setMonth(now.getMonth() + 3);
      break;
    case 'yearly':
      nextDate.setFullYear(now.getFullYear() + 1);
      break;
    default:
      nextDate.setMonth(now.getMonth() + 1);
  }

  return Timestamp.fromDate(nextDate);
}

/**
 * Create Recurring Outflow Cloud Function
 */
export const createRecurringOutflow = onCall<CreateRecurringOutflowRequest, Promise<CreateRecurringOutflowResponse>>(
  async (request) => {
    try {
      // Validate authentication
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be authenticated');
      }
      const userId = request.auth.uid;

      const {
        description,
        merchantName,
        amount,
        frequency,
        expenseType,
        isEssential,
        dueDay,
        userNotes,
        familyId,
      } = request.data;

      // Validate required fields
      if (!description || !description.trim()) {
        throw new HttpsError('invalid-argument', 'Bill name (description) is required');
      }

      if (!amount || amount <= 0) {
        throw new HttpsError('invalid-argument', 'Amount must be greater than 0');
      }

      if (!frequency) {
        throw new HttpsError('invalid-argument', 'Frequency is required');
      }

      const validFrequencies = ['weekly', 'bi_weekly', 'monthly', 'quarterly', 'yearly'];
      if (!validFrequencies.includes(frequency)) {
        throw new HttpsError('invalid-argument', `Frequency must be one of: ${validFrequencies.join(', ')}`);
      }

      // Generate a unique stream ID for user-created bills
      const streamId = `user_bill_${userId}_${Date.now()}`;

      // Calculate next due date
      const nextDueDate = calculateNextDueDate(frequency, dueDay);

      // Create the recurring outflow document
      const outflowData = {
        // Core identification
        streamId,
        itemId: 'manual', // Not from Plaid
        userId,
        familyId: familyId || null,
        accountId: 'manual', // User-created, no specific account

        // Stream classification
        isActive: true,
        status: 'MATURE', // User-created bills are immediately mature

        // Transaction details
        description: description.trim(),
        merchantName: merchantName?.trim() || null,
        category: expenseType ? [expenseType] : ['other'], // Simple category array
        personalFinanceCategory: null, // Not applicable for manual entries

        // Amount information (in Plaid format for consistency)
        averageAmount: {
          amount,
          isoCurrencyCode: 'USD',
          unofficialCurrencyCode: null,
        },
        lastAmount: {
          amount,
          isoCurrencyCode: 'USD',
          unofficialCurrencyCode: null,
        },

        // Frequency and timing
        frequency: mapFrequencyToPlaidFormat(frequency),

        // Historical data
        firstDate: Timestamp.now(), // Created now
        lastDate: Timestamp.now(), // Created now
        transactionIds: [], // No actual transactions yet

        // Family Finance specific fields
        userCategory: null, // Can be set later
        userNotes: userNotes?.trim() || null,
        tags: [],
        isHidden: false,

        // Outflow-specific fields
        expenseType: expenseType || 'other',
        isEssential: isEssential || false,
        merchantCategory: null,
        isCancellable: true, // User-created bills are cancellable
        reminderDays: 3, // Default reminder 3 days before due

        // Additional metadata for user-created bills
        isUserCreated: true, // Flag to distinguish from Plaid-synced bills
        outflowSource: 'user', // Source of this outflow: 'user' or 'plaid'
        dueDay: frequency === 'monthly' ? (dueDay || 1) : null,
        nextDueDate, // When this bill is next due

        // Sync metadata (not applicable but required by interface)
        lastSyncedAt: Timestamp.now(),
        syncVersion: 1,

        // Timestamps
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Create the document in the outflows collection
      const outflowRef = await db.collection('outflows').add(outflowData);

      console.log(`[createRecurringOutflow] Created recurring outflow ${outflowRef.id} for user ${userId}`);

      return {
        success: true,
        outflowId: outflowRef.id,
        message: 'Recurring outflow created successfully',
      };

    } catch (error) {
      console.error('[createRecurringOutflow] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        'internal',
        'Failed to create recurring outflow',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);
