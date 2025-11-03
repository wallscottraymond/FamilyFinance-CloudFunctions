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
import {
  buildAccessControl,
  buildMetadata,
  buildRelationships
} from '../../../../utils/documentStructure';

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
  groupId?: string; // Group this outflow belongs to (optional)
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
        groupId,
      } = request.data;

      // Validation constants
      const VALIDATION = {
        MAX_AMOUNT: 1000000,           // $1M max
        MIN_AMOUNT: 0.01,              // $0.01 min
        MAX_DESCRIPTION_LENGTH: 200,
        MAX_NOTES_LENGTH: 1000,
        MAX_MERCHANT_NAME_LENGTH: 100,
        MIN_DUE_DAY: 1,
        MAX_DUE_DAY: 31,
      };

      // Validate required fields
      if (!description || !description.trim()) {
        throw new HttpsError('invalid-argument', 'Bill name (description) is required');
      }

      // Validate description length
      if (description.trim().length > VALIDATION.MAX_DESCRIPTION_LENGTH) {
        throw new HttpsError(
          'invalid-argument',
          `Description must be ${VALIDATION.MAX_DESCRIPTION_LENGTH} characters or less (current: ${description.trim().length})`
        );
      }

      // Validate amount with upper and lower bounds
      if (!amount || amount < VALIDATION.MIN_AMOUNT) {
        throw new HttpsError(
          'invalid-argument',
          `Amount must be at least $${VALIDATION.MIN_AMOUNT}`
        );
      }

      if (amount > VALIDATION.MAX_AMOUNT) {
        throw new HttpsError(
          'invalid-argument',
          `Amount cannot exceed $${VALIDATION.MAX_AMOUNT.toLocaleString()}`
        );
      }

      // Validate frequency
      if (!frequency) {
        throw new HttpsError('invalid-argument', 'Frequency is required');
      }

      const validFrequencies = ['weekly', 'bi_weekly', 'monthly', 'quarterly', 'yearly'];
      if (!validFrequencies.includes(frequency)) {
        throw new HttpsError('invalid-argument', `Frequency must be one of: ${validFrequencies.join(', ')}`);
      }

      // Validate dueDay if provided
      if (dueDay !== undefined && dueDay !== null) {
        if (!Number.isInteger(dueDay) || dueDay < VALIDATION.MIN_DUE_DAY || dueDay > VALIDATION.MAX_DUE_DAY) {
          throw new HttpsError(
            'invalid-argument',
            `Due day must be an integer between ${VALIDATION.MIN_DUE_DAY} and ${VALIDATION.MAX_DUE_DAY} (current: ${dueDay})`
          );
        }
      }

      // Validate merchantName length if provided
      if (merchantName && merchantName.trim().length > VALIDATION.MAX_MERCHANT_NAME_LENGTH) {
        throw new HttpsError(
          'invalid-argument',
          `Merchant name must be ${VALIDATION.MAX_MERCHANT_NAME_LENGTH} characters or less (current: ${merchantName.trim().length})`
        );
      }

      // Validate userNotes length if provided
      if (userNotes && userNotes.trim().length > VALIDATION.MAX_NOTES_LENGTH) {
        throw new HttpsError(
          'invalid-argument',
          `Notes must be ${VALIDATION.MAX_NOTES_LENGTH} characters or less (current: ${userNotes.trim().length})`
        );
      }

      // Validate expense type if provided
      if (expenseType) {
        const validExpenseTypes = ['subscription', 'utility', 'loan', 'rent', 'insurance', 'tax', 'other'];
        if (!validExpenseTypes.includes(expenseType)) {
          throw new HttpsError(
            'invalid-argument',
            `Expense type must be one of: ${validExpenseTypes.join(', ')}`
          );
        }
      }

      // Generate a unique stream ID for user-created bills
      const streamId = `user_bill_${userId}_${Date.now()}`;

      // Calculate next due date
      const nextDueDate = calculateNextDueDate(frequency, dueDay);

      const now = Timestamp.now();

      // Step 1: Build complete outflow document with defaults
      // Convert single groupId to groupIds array
      const groupIds: string[] = groupId ? [groupId] : [];

      const outflowDoc = {
        // === QUERY-CRITICAL FIELDS AT ROOT (defaults) ===
        userId,
        groupIds,
        streamId,
        isActive: true,
        status: 'MATURE',
        createdAt: FieldValue.serverTimestamp(),
        lastDate: now,

        // === NESTED ACCESS CONTROL OBJECT (defaults) ===
        access: buildAccessControl(userId, userId, groupIds),

        // === NESTED CATEGORIES OBJECT ===
        categories: {
          primary: expenseType || 'other',
          secondary: merchantName?.trim() || undefined,
          tags: []
        },

        // === NESTED METADATA OBJECT ===
        metadata: buildMetadata(userId, 'manual', {
          notes: userNotes?.trim() || undefined,
          lastSyncedAt: now,
          version: 1,
          isUserCreated: true,
          outflowSource: 'user',
          dueDay: frequency === 'monthly' ? (dueDay || 1) : undefined,
          nextDueDate: nextDueDate
        }),

        // === NESTED RELATIONSHIPS OBJECT ===
        relationships: buildRelationships({
          parentId: 'manual',
          parentType: 'user',
          accountId: 'manual'
        }),

        // === OUTFLOW-SPECIFIC FIELDS AT ROOT ===
        itemId: 'manual',
        accountId: 'manual',
        description: description.trim(),
        merchantName: merchantName?.trim() || null,
        category: expenseType ? [expenseType] : ['other'],
        personalFinanceCategory: null,

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
        firstDate: now,
        transactionIds: [],

        // Outflow-specific fields
        expenseType: expenseType || 'other',
        isEssential: isEssential || false,
        merchantCategory: null,
        isCancellable: true,
        reminderDays: 3,
        isHidden: false,
        syncVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Log document creation
      console.log('Document created:', {
        userId,
        groupIds,
        groupCount: groupIds.length
      });

      // Save to Firestore
      const outflowRef = await db.collection('outflows').add(outflowDoc);

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
