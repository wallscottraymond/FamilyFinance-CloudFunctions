/**
 * Create Manual Inflow Callable
 *
 * Creates a new manually-entered recurring income stream.
 * For income not detected by Plaid (freelance work, side jobs, etc.)
 *
 * This function:
 * 1. Creates the inflow document
 * 2. Triggers period generation via onInflowCreated trigger
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  IncomeType,
  IncomeVariability,
  HourlyIncomeConfig,
  CommissionIncomeConfig,
  BonusIncomeConfig,
  VariableIncomeConfig,
  PlaidRecurringFrequency
} from '../../../../types';

interface CreateManualInflowRequest {
  // Required fields
  name: string;
  amount: number;
  frequency: PlaidRecurringFrequency | string;
  firstExpectedDate: string; // ISO date string

  // Optional fields
  description?: string;
  accountId?: string;        // Associated account (optional)

  // Income type configuration
  incomeType: IncomeType;
  incomeVariability?: IncomeVariability;
  hourlyConfig?: HourlyIncomeConfig;
  commissionConfig?: CommissionIncomeConfig;
  bonusConfig?: BonusIncomeConfig;
  variableConfig?: VariableIncomeConfig;
}

interface CreateManualInflowResponse {
  success: boolean;
  inflowId: string;
  message: string;
}

/**
 * Get default variability for an income type
 */
function getDefaultVariability(incomeType: IncomeType): IncomeVariability {
  switch (incomeType) {
    case IncomeType.SALARY:
    case IncomeType.PENSION:
      return IncomeVariability.FIXED;
    case IncomeType.RENTAL:
    case IncomeType.GOVERNMENT:
      return IncomeVariability.LOW;
    case IncomeType.HOURLY:
    case IncomeType.BASE_PLUS_COMMISSION:
    case IncomeType.INVESTMENT:
      return IncomeVariability.MEDIUM;
    case IncomeType.COMMISSION_ONLY:
    case IncomeType.BONUS:
    case IncomeType.FREELANCE:
      return IncomeVariability.HIGH;
    default:
      return IncomeVariability.MEDIUM;
  }
}

export const createManualInflow = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request): Promise<CreateManualInflowResponse> => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const data = request.data as CreateManualInflowRequest;

    // Validate required fields
    if (!data.name || data.name.trim() === '') {
      throw new HttpsError('invalid-argument', 'Name is required');
    }
    if (typeof data.amount !== 'number' || data.amount <= 0) {
      throw new HttpsError('invalid-argument', 'Amount must be a positive number');
    }
    if (!data.frequency) {
      throw new HttpsError('invalid-argument', 'Frequency is required');
    }
    if (!data.firstExpectedDate) {
      throw new HttpsError('invalid-argument', 'First expected date is required');
    }
    if (!data.incomeType) {
      throw new HttpsError('invalid-argument', 'Income type is required');
    }

    const db = admin.firestore();
    const now = Timestamp.now();

    // Parse first expected date
    let firstDate: Date;
    try {
      firstDate = new Date(data.firstExpectedDate);
      if (isNaN(firstDate.getTime())) {
        throw new Error('Invalid date');
      }
    } catch {
      throw new HttpsError('invalid-argument', 'Invalid first expected date format');
    }

    // Generate unique ID
    const inflowId = db.collection('inflows').doc().id;

    console.log(`[createManualInflow] Creating manual inflow: ${inflowId} for user: ${userId}`);

    try {
      // Determine variability
      const incomeVariability = data.incomeVariability || getDefaultVariability(data.incomeType);

      // Calculate predicted next date (same as first date for new income)
      const predictedNextDate = Timestamp.fromDate(firstDate);

      // Build inflow document
      const inflowDoc: Record<string, any> = {
        // === DOCUMENT IDENTITY ===
        id: inflowId,

        // === OWNERSHIP & ACCESS ===
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
        groupId: null,
        groupIds: [],
        isPrivate: true,

        // === PLAID IDENTIFIERS (null for manual) ===
        plaidItemId: '',
        accountId: data.accountId || '',

        // === FINANCIAL DATA ===
        lastAmount: data.amount,
        averageAmount: data.amount,
        currency: 'USD',
        unofficialCurrency: null,

        // === DESCRIPTIVE INFO ===
        description: data.description || data.name,
        merchantName: data.name,
        userCustomName: data.name,

        // === TEMPORAL DATA ===
        frequency: data.frequency,
        firstDate: Timestamp.fromDate(firstDate),
        lastDate: Timestamp.fromDate(firstDate),
        predictedNextDate: predictedNextDate,

        // === CATEGORIZATION ===
        plaidPrimaryCategory: 'INCOME',
        plaidDetailedCategory: 'INCOME_OTHER',
        plaidCategoryId: null,
        internalPrimaryCategory: null,
        internalDetailedCategory: null,

        // === INCOME CLASSIFICATION ===
        incomeType: data.incomeType,
        incomeVariability: incomeVariability,
        isRegularSalary: data.incomeType === IncomeType.SALARY,
        isUserClassified: true,

        // === TYPE-SPECIFIC CONFIGURATION ===
        hourlyConfig: data.hourlyConfig || null,
        commissionConfig: data.commissionConfig || null,
        bonusConfig: data.bonusConfig || null,
        variableConfig: data.variableConfig || null,

        // === STATUS & CONTROL ===
        source: 'manual',
        isActive: true,
        isHidden: false,
        isUserModified: false,
        plaidStatus: 'MANUAL',
        plaidConfidenceLevel: null,

        // === TRANSACTION REFERENCES ===
        transactionIds: [],

        // === USER INTERACTION ===
        tags: [],
        rules: [],

        // === AUDIT TRAIL ===
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: null
      };

      // Write to Firestore
      await db.collection('inflows').doc(inflowId).set(inflowDoc);

      console.log(`[createManualInflow] Successfully created inflow: ${inflowId}`);

      // The onInflowCreated trigger will automatically generate inflow_periods

      return {
        success: true,
        inflowId,
        message: 'Manual income created successfully. Periods will be generated automatically.'
      };

    } catch (error: any) {
      console.error('[createManualInflow] Error:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', error.message || 'Failed to create manual inflow');
    }
  }
);
