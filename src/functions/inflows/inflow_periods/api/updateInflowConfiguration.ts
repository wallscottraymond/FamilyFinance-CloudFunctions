/**
 * Update Inflow Configuration Callable
 *
 * Updates the income type configuration for an inflow and recalculates
 * all existing InflowPeriods in place (preserving user notes and other data).
 *
 * Key behaviors:
 * - Updates income type and type-specific configuration
 * - Recalculates expectedAmount and predictionConfidence for all periods
 * - Preserves existing period data (notes, transaction matches)
 * - Sets isUserClassified: true to indicate user has configured the income
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
  InflowPeriod
} from '../../../../types';

interface UpdateInflowConfigRequest {
  inflowId: string;
  incomeType: IncomeType;
  incomeVariability?: IncomeVariability;
  hourlyConfig?: HourlyIncomeConfig;
  commissionConfig?: CommissionIncomeConfig;
  bonusConfig?: BonusIncomeConfig;
  variableConfig?: VariableIncomeConfig;
}

interface UpdateInflowConfigResponse {
  success: boolean;
  inflowId: string;
  periodsUpdated: number;
  newPrediction: {
    expectedAmount: number;
    confidence: 'high' | 'medium' | 'low';
  };
}

/**
 * Get the default variability for an income type
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

/**
 * Calculate prediction confidence based on income type
 */
function getPredictionConfidence(incomeType: IncomeType): 'high' | 'medium' | 'low' {
  switch (incomeType) {
    case IncomeType.SALARY:
    case IncomeType.PENSION:
    case IncomeType.GOVERNMENT:
    case IncomeType.RENTAL:
      return 'high';
    case IncomeType.HOURLY:
    case IncomeType.BASE_PLUS_COMMISSION:
    case IncomeType.INVESTMENT:
      return 'medium';
    case IncomeType.COMMISSION_ONLY:
    case IncomeType.BONUS:
    case IncomeType.FREELANCE:
    case IncomeType.OTHER:
      return 'low';
    default:
      return 'medium';
  }
}

/**
 * Calculate expected amount based on income type and configuration
 */
function calculateExpectedAmount(
  incomeType: IncomeType,
  averageAmount: number,
  config: {
    hourlyConfig?: HourlyIncomeConfig;
    commissionConfig?: CommissionIncomeConfig;
    bonusConfig?: BonusIncomeConfig;
    variableConfig?: VariableIncomeConfig;
  }
): number {
  switch (incomeType) {
    case IncomeType.SALARY:
    case IncomeType.PENSION:
    case IncomeType.GOVERNMENT:
    case IncomeType.RENTAL:
      // Fixed income types use the average amount
      return averageAmount;

    case IncomeType.HOURLY:
      if (config.hourlyConfig) {
        const { hourlyRate, expectedHoursPerPeriod, includeOvertime, overtimeRate, expectedOvertimeHours } = config.hourlyConfig;
        let total = hourlyRate * expectedHoursPerPeriod;
        if (includeOvertime && overtimeRate && expectedOvertimeHours) {
          total += hourlyRate * overtimeRate * expectedOvertimeHours;
        }
        return Math.round(total * 100) / 100;
      }
      return averageAmount;

    case IncomeType.BASE_PLUS_COMMISSION:
      if (config.commissionConfig) {
        const baseAmount = config.commissionConfig.baseAmount || 0;
        const targetCommission = config.commissionConfig.targetCommission || 0;
        return baseAmount + targetCommission;
      }
      return averageAmount;

    case IncomeType.COMMISSION_ONLY:
      // Use rolling average or user override
      if (config.variableConfig?.userOverrideAmount != null) {
        return config.variableConfig.userOverrideAmount;
      }
      // Otherwise use the existing average
      return averageAmount;

    case IncomeType.BONUS:
      // Use last bonus amount if available
      if (config.bonusConfig?.lastBonusAmount) {
        return config.bonusConfig.lastBonusAmount;
      }
      return averageAmount;

    case IncomeType.FREELANCE:
    case IncomeType.INVESTMENT:
    case IncomeType.OTHER:
      // Use user override or rolling average
      if (config.variableConfig?.userOverrideAmount != null) {
        return config.variableConfig.userOverrideAmount;
      }
      return averageAmount;

    default:
      return averageAmount;
  }
}

export const updateInflowConfiguration = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request): Promise<UpdateInflowConfigResponse> => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const data = request.data as UpdateInflowConfigRequest;
    const { inflowId, incomeType, incomeVariability, hourlyConfig, commissionConfig, bonusConfig, variableConfig } = data;

    // Validate required fields
    if (!inflowId) {
      throw new HttpsError('invalid-argument', 'inflowId is required');
    }
    if (!incomeType) {
      throw new HttpsError('invalid-argument', 'incomeType is required');
    }

    // Validate income type is valid enum value
    if (!Object.values(IncomeType).includes(incomeType)) {
      throw new HttpsError('invalid-argument', `Invalid incomeType: ${incomeType}`);
    }

    const db = admin.firestore();
    const now = Timestamp.now();

    console.log(`[updateInflowConfiguration] Starting for inflowId: ${inflowId}, incomeType: ${incomeType}`);

    try {
      // Get the inflow document
      const inflowRef = db.collection('inflows').doc(inflowId);
      const inflowDoc = await inflowRef.get();

      if (!inflowDoc.exists) {
        throw new HttpsError('not-found', `Inflow ${inflowId} not found`);
      }

      const inflowData = inflowDoc.data()!;

      // Verify ownership
      if (inflowData.ownerId !== userId) {
        throw new HttpsError('permission-denied', 'You can only update your own inflows');
      }

      // Calculate expected amount based on new configuration
      const averageAmount = Math.abs(inflowData.averageAmount || 0);
      const newExpectedAmount = calculateExpectedAmount(incomeType, averageAmount, {
        hourlyConfig,
        commissionConfig,
        bonusConfig,
        variableConfig
      });

      // Determine variability (use provided or calculate default)
      const finalVariability = incomeVariability || getDefaultVariability(incomeType);
      const predictionConfidence = getPredictionConfidence(incomeType);

      // Build update object for inflow
      const inflowUpdate: Record<string, any> = {
        incomeType,
        incomeVariability: finalVariability,
        isUserClassified: true,
        updatedAt: now,
        updatedBy: userId
      };

      // Clear old configs and set new one based on type
      inflowUpdate.hourlyConfig = null;
      inflowUpdate.commissionConfig = null;
      inflowUpdate.bonusConfig = null;
      inflowUpdate.variableConfig = null;

      // Set the appropriate config based on income type
      if (incomeType === IncomeType.HOURLY && hourlyConfig) {
        inflowUpdate.hourlyConfig = hourlyConfig;
      } else if ((incomeType === IncomeType.BASE_PLUS_COMMISSION || incomeType === IncomeType.COMMISSION_ONLY) && commissionConfig) {
        inflowUpdate.commissionConfig = commissionConfig;
      } else if (incomeType === IncomeType.BONUS && bonusConfig) {
        inflowUpdate.bonusConfig = bonusConfig;
      } else if (variableConfig) {
        inflowUpdate.variableConfig = variableConfig;
      }

      // Update the inflow document
      await inflowRef.update(inflowUpdate);
      console.log(`[updateInflowConfiguration] Updated inflow ${inflowId}`);

      // Get all inflow periods for this inflow
      const periodsQuery = db.collection('inflow_periods')
        .where('inflowId', '==', inflowId);

      const periodsSnapshot = await periodsQuery.get();
      console.log(`[updateInflowConfiguration] Found ${periodsSnapshot.size} periods to update`);

      // Update periods in batches
      let periodsUpdated = 0;
      const batchSize = 500;
      let batch = db.batch();
      let batchCount = 0;

      for (const periodDoc of periodsSnapshot.docs) {
        const periodData = periodDoc.data() as InflowPeriod;
        const numberOfOccurrences = periodData.numberOfOccurrencesInPeriod || 1;

        // Calculate new expected amounts
        const newAmountPerOccurrence = newExpectedAmount;
        const newTotalAmountDue = newAmountPerOccurrence * numberOfOccurrences;
        const newTotalAmountUnpaid = newTotalAmountDue - (periodData.totalAmountPaid || 0);

        // Calculate new withholding amount (for budget purposes)
        // This is the expected amount earned during this period
        const daysInPeriod = periodData.cycleDays || 30;
        const newDailyWithholdingRate = newExpectedAmount / daysInPeriod;
        const newAmountWithheld = Math.round(newDailyWithholdingRate * daysInPeriod * 100) / 100;

        // Update period with new calculations
        const periodUpdate: Partial<InflowPeriod> = {
          incomeType: incomeType,
          predictionConfidence: predictionConfidence,
          expectedAmount: newTotalAmountDue,
          amountPerOccurrence: newAmountPerOccurrence,
          averageAmount: newAmountPerOccurrence,
          totalAmountDue: newTotalAmountDue,
          totalAmountUnpaid: newTotalAmountUnpaid,
          amountWithheld: newAmountWithheld,
          dailyWithholdingRate: newDailyWithholdingRate,
          updatedAt: now,
          lastCalculated: now
        };

        // Recalculate dollar progress percentage
        if (newTotalAmountDue > 0) {
          periodUpdate.dollarProgressPercentage = Math.round(((periodData.totalAmountPaid || 0) / newTotalAmountDue) * 100);
        }

        batch.update(periodDoc.ref, periodUpdate);
        batchCount++;
        periodsUpdated++;

        // Commit batch when it reaches the limit
        if (batchCount >= batchSize) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      // Commit remaining updates
      if (batchCount > 0) {
        await batch.commit();
      }

      console.log(`[updateInflowConfiguration] Updated ${periodsUpdated} periods`);

      return {
        success: true,
        inflowId,
        periodsUpdated,
        newPrediction: {
          expectedAmount: newExpectedAmount,
          confidence: predictionConfidence
        }
      };

    } catch (error: any) {
      console.error('[updateInflowConfiguration] Error:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', error.message || 'Failed to update inflow configuration');
    }
  }
);
