/**
 * Predict Next Payment Utility (Inflows)
 *
 * Calculates when the next income payment will be received and the expected amount.
 * Handles various income types including salary, commission, bonuses, and variable income.
 *
 * Prediction Priority:
 * 1. Plaid's predicted next date (if available and trusted)
 * 2. User override amount (for variable income)
 * 3. Rolling average (for variable income)
 * 4. Frequency-based calculation from last date
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  Inflow,
  PlaidRecurringFrequency,
  IncomeType
} from '../../../../types';

/**
 * Payment prediction result
 */
export interface PaymentPrediction {
  expectedDate: Timestamp;
  expectedAmount: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  predictionMethod: 'plaid' | 'frequency' | 'rolling_average' | 'user_override' | 'hourly_calc' | 'commission_calc';
  isInPeriod: boolean;
  daysUntilPayment: number;
}

/**
 * Add frequency interval to a date
 * Handles month-end dates by capping at the last day of the target month
 */
function addFrequencyInterval(date: Date, frequency: PlaidRecurringFrequency | string): Date {
  const newDate = new Date(date);
  const originalDay = date.getDate();

  switch (frequency) {
    case PlaidRecurringFrequency.WEEKLY:
    case 'WEEKLY':
      newDate.setDate(newDate.getDate() + 7);
      break;

    case PlaidRecurringFrequency.BIWEEKLY:
    case 'BIWEEKLY':
      newDate.setDate(newDate.getDate() + 14);
      break;

    case PlaidRecurringFrequency.SEMI_MONTHLY:
    case 'SEMI_MONTHLY':
      newDate.setDate(newDate.getDate() + 15);
      break;

    case PlaidRecurringFrequency.MONTHLY:
    case 'MONTHLY': {
      const targetMonth = newDate.getMonth() + 1;
      newDate.setMonth(targetMonth);
      // Handle month-end overflow (e.g., Jan 31 → Feb 28)
      if (newDate.getDate() !== originalDay) {
        // Rolled over to next month, go back to last day of target month
        newDate.setDate(0); // Sets to last day of previous month
      }
      break;
    }

    case 'QUARTERLY': {
      const targetMonth = newDate.getMonth() + 3;
      newDate.setMonth(targetMonth);
      // Handle month-end overflow
      if (newDate.getDate() !== originalDay) {
        newDate.setDate(0);
      }
      break;
    }

    case PlaidRecurringFrequency.ANNUALLY:
    case 'ANNUALLY': {
      const targetYear = newDate.getFullYear() + 1;
      newDate.setFullYear(targetYear);
      // Handle leap year edge case (Feb 29 → Feb 28)
      if (newDate.getDate() !== originalDay) {
        newDate.setDate(0);
      }
      break;
    }

    default: {
      const targetMonth = newDate.getMonth() + 1;
      newDate.setMonth(targetMonth);
      if (newDate.getDate() !== originalDay) {
        newDate.setDate(0);
      }
    }
  }

  return newDate;
}

/**
 * Calculate rolling average from transaction history
 * For now, this returns the average amount from the inflow
 * Future: Could fetch actual transaction amounts and calculate true rolling average
 */
function calculateRollingAverage(inflow: Partial<Inflow>, periods: number = 3): number {
  // For now, use the average amount from Plaid/inflow
  // In the future, this could query transaction history
  return Math.abs(inflow.averageAmount || 0);
}

/**
 * Determine confidence level based on income type and prediction method
 *
 * Income Type Confidence Mapping:
 * - HIGH: SALARY, PENSION, GOVERNMENT, RENTAL
 * - MEDIUM: HOURLY, BASE_PLUS_COMMISSION, INVESTMENT
 * - LOW: COMMISSION_ONLY, BONUS, FREELANCE, OTHER
 */
function determineConfidenceLevel(
  inflow: Partial<Inflow>,
  predictionMethod: PaymentPrediction['predictionMethod']
): PaymentPrediction['confidenceLevel'] {
  const incomeType = inflow.incomeType as IncomeType | string;
  const isRegularSalary = inflow.isRegularSalary;

  // Check by income type enum first (most accurate)
  switch (incomeType) {
    case IncomeType.SALARY:
    case IncomeType.PENSION:
    case IncomeType.GOVERNMENT:
    case IncomeType.RENTAL:
      return 'high';

    case IncomeType.HOURLY:
      // Hourly with config is medium, without is lower
      return predictionMethod === 'hourly_calc' ? 'medium' : 'low';

    case IncomeType.BASE_PLUS_COMMISSION:
      return 'medium';

    case IncomeType.INVESTMENT:
      return 'medium';

    case IncomeType.COMMISSION_ONLY:
    case IncomeType.BONUS:
    case IncomeType.FREELANCE:
      return 'low';

    case IncomeType.OTHER:
      return 'low';
  }

  // Fallback: Legacy logic for non-enum income types
  // High confidence: Regular salary with Plaid prediction
  if (isRegularSalary && predictionMethod === 'plaid') {
    return 'high';
  }

  // High confidence: Regular salary with frequency calculation
  if (isRegularSalary && predictionMethod === 'frequency') {
    return 'high';
  }

  // Medium confidence: Variable income with rolling average or user override
  if (predictionMethod === 'rolling_average' || predictionMethod === 'user_override') {
    return 'medium';
  }

  // Medium confidence: Non-salary income with Plaid prediction
  if (predictionMethod === 'plaid' && !isRegularSalary) {
    return 'medium';
  }

  // Low confidence: Commission or bonus (legacy string values)
  if (incomeType === 'commission' || incomeType === 'bonus') {
    return 'low';
  }

  // Default to medium
  return 'medium';
}

/**
 * Calculate expected amount based on income type and configuration
 *
 * Income Type Calculation Strategy:
 * - SALARY, PENSION, GOVERNMENT, RENTAL: Use averageAmount (high confidence)
 * - HOURLY: hourlyRate × expectedHours (medium confidence)
 * - BASE_PLUS_COMMISSION: baseAmount + targetCommission (medium confidence)
 * - COMMISSION_ONLY: Rolling average or user override (low confidence)
 * - BONUS: Last bonus amount or schedule-based (low confidence)
 * - FREELANCE, INVESTMENT: Rolling average or user override (low-medium confidence)
 */
function calculateExpectedAmountByType(
  incomeType: IncomeType | string,
  averageAmount: number,
  inflow: Partial<Inflow>
): { amount: number; method?: PaymentPrediction['predictionMethod'] } {
  // Access type-specific configs
  const hourlyConfig = inflow.hourlyConfig;
  const commissionConfig = inflow.commissionConfig;
  const bonusConfig = inflow.bonusConfig;
  const variableConfig = inflow.variableConfig;

  switch (incomeType) {
    // Fixed income types - use average amount
    case IncomeType.SALARY:
    case IncomeType.PENSION:
    case IncomeType.GOVERNMENT:
    case IncomeType.RENTAL:
      return { amount: averageAmount };

    // Hourly income - calculate from rate × hours
    case IncomeType.HOURLY:
      if (hourlyConfig) {
        const { hourlyRate, expectedHoursPerPeriod, includeOvertime, overtimeRate, expectedOvertimeHours } = hourlyConfig;
        let total = hourlyRate * expectedHoursPerPeriod;
        if (includeOvertime && overtimeRate && expectedOvertimeHours) {
          total += hourlyRate * overtimeRate * expectedOvertimeHours;
        }
        return { amount: Math.round(total * 100) / 100, method: 'hourly_calc' };
      }
      return { amount: averageAmount };

    // Base + Commission - add base and target
    case IncomeType.BASE_PLUS_COMMISSION:
      if (commissionConfig && commissionConfig.basePlusCommission) {
        const baseAmount = commissionConfig.baseAmount || 0;
        const targetCommission = commissionConfig.targetCommission || 0;
        return { amount: baseAmount + targetCommission, method: 'commission_calc' };
      }
      return { amount: averageAmount };

    // Commission only - use rolling average or override
    case IncomeType.COMMISSION_ONLY:
      if (variableConfig?.userOverrideAmount != null && variableConfig.userOverrideAmount > 0) {
        return { amount: variableConfig.userOverrideAmount, method: 'user_override' };
      }
      if (variableConfig?.useRollingAverage) {
        const periods = variableConfig.rollingAveragePeriods || 3;
        return { amount: calculateRollingAverage(inflow, periods), method: 'rolling_average' };
      }
      // Fallback to average for commission-only
      return { amount: averageAmount };

    // Bonus - use last bonus amount or average
    case IncomeType.BONUS:
      if (bonusConfig?.lastBonusAmount && bonusConfig.lastBonusAmount > 0) {
        return { amount: bonusConfig.lastBonusAmount };
      }
      return { amount: averageAmount };

    // Investment income - use average (dividends are typically consistent)
    case IncomeType.INVESTMENT:
      return { amount: averageAmount };

    // Freelance - highly variable, use override or rolling average
    case IncomeType.FREELANCE:
      if (variableConfig?.userOverrideAmount != null && variableConfig.userOverrideAmount > 0) {
        return { amount: variableConfig.userOverrideAmount, method: 'user_override' };
      }
      if (variableConfig?.useRollingAverage) {
        const periods = variableConfig.rollingAveragePeriods || 3;
        return { amount: calculateRollingAverage(inflow, periods), method: 'rolling_average' };
      }
      return { amount: averageAmount };

    // Other / default - use variable config if available, else average
    case IncomeType.OTHER:
    default:
      if (variableConfig?.userOverrideAmount != null && variableConfig.userOverrideAmount > 0) {
        return { amount: variableConfig.userOverrideAmount, method: 'user_override' };
      }
      return { amount: averageAmount };
  }
}

/**
 * Predict the next payment date and amount for an income stream
 *
 * @param inflow - The recurring income definition
 * @param fromDate - The reference date to predict from (default: now)
 * @returns Payment prediction with date, amount, and confidence
 *
 * @example
 * ```typescript
 * // Regular biweekly salary
 * const prediction = predictNextPayment(salaryInflow);
 * // { expectedDate: Jan 17, expectedAmount: 2000, confidenceLevel: 'high', ... }
 *
 * // Variable commission income with user override
 * const prediction = predictNextPayment(commissionInflow);
 * // { expectedDate: Jan 31, expectedAmount: 3500, confidenceLevel: 'medium', predictionMethod: 'user_override' }
 * ```
 */
export function predictNextPayment(
  inflow: Partial<Inflow>,
  fromDate: Date = new Date()
): PaymentPrediction | null {
  // Handle inactive income - don't predict payments
  if (inflow.isActive === false) {
    return null;
  }

  let expectedDate: Date;
  let expectedAmount: number;
  let predictionMethod: PaymentPrediction['predictionMethod'];

  // Step 1: Determine expected date
  // Priority: Plaid's predictedNextDate > frequency calculation from lastDate

  if (inflow.predictedNextDate) {
    expectedDate = inflow.predictedNextDate.toDate();
    predictionMethod = 'plaid';

    // If predicted date is in the past, calculate forward
    if (expectedDate < fromDate) {
      const frequency = inflow.frequency as PlaidRecurringFrequency | string;
      while (expectedDate < fromDate) {
        expectedDate = addFrequencyInterval(expectedDate, frequency);
      }
      predictionMethod = 'frequency';
    }
  } else if (inflow.lastDate) {
    // Calculate from last date using frequency
    const frequency = inflow.frequency as PlaidRecurringFrequency | string;
    expectedDate = inflow.lastDate.toDate();

    while (expectedDate < fromDate) {
      expectedDate = addFrequencyInterval(expectedDate, frequency);
    }
    predictionMethod = 'frequency';
  } else if (inflow.firstDate) {
    // Fallback to first date
    const frequency = inflow.frequency as PlaidRecurringFrequency | string;
    expectedDate = inflow.firstDate.toDate();

    while (expectedDate < fromDate) {
      expectedDate = addFrequencyInterval(expectedDate, frequency);
    }
    predictionMethod = 'frequency';
  } else {
    // No date available - return prediction for 30 days from now
    expectedDate = new Date(fromDate);
    expectedDate.setDate(expectedDate.getDate() + 30);
    predictionMethod = 'frequency';
  }

  // Step 2: Determine expected amount based on income type
  // Priority varies by income type - see calculateExpectedAmountByType

  const incomeType = inflow.incomeType as IncomeType | string;
  const averageAmount = Math.abs(inflow.averageAmount || 0);

  // Calculate based on income type and configuration
  const amountResult = calculateExpectedAmountByType(incomeType, averageAmount, inflow);
  expectedAmount = amountResult.amount;

  // Update prediction method if using type-specific calculation
  if (amountResult.method) {
    predictionMethod = amountResult.method;
  }

  // Calculate days until payment
  const daysUntilPayment = Math.ceil(
    (expectedDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Determine confidence level
  const confidenceLevel = determineConfidenceLevel(inflow, predictionMethod);

  // isInPeriod defaults to true (caller can check against their specific period)
  const isInPeriod = true;

  console.log(
    `[predictNextPayment] Inflow: ${inflow.description || inflow.id}, ` +
    `Expected: ${expectedDate.toISOString().split('T')[0]}, ` +
    `Amount: $${expectedAmount.toFixed(2)}, ` +
    `Method: ${predictionMethod}, Confidence: ${confidenceLevel}`
  );

  return {
    expectedDate: Timestamp.fromDate(expectedDate),
    expectedAmount,
    confidenceLevel,
    predictionMethod,
    isInPeriod,
    daysUntilPayment
  };
}

/**
 * Predict all payments expected within a given period
 *
 * @param inflow - The recurring income definition
 * @param periodStart - Start of the viewing period
 * @param periodEnd - End of the viewing period
 * @returns Array of payment predictions for the period
 *
 * @example
 * ```typescript
 * // Weekly income in January
 * const predictions = predictPaymentsInPeriod(
 *   weeklyInflow,
 *   new Date('2025-01-01'),
 *   new Date('2025-01-31')
 * );
 * // Returns 4-5 predictions for each expected payment
 * ```
 */
export function predictPaymentsInPeriod(
  inflow: Partial<Inflow>,
  periodStart: Date,
  periodEnd: Date
): PaymentPrediction[] {
  const predictions: PaymentPrediction[] = [];

  // Get base prediction for first payment
  const basePrediction = predictNextPayment(inflow, new Date(periodStart.getTime() - 86400000)); // Day before period start

  // If inactive income (returns null), return empty array
  if (!basePrediction) {
    return predictions;
  }

  // If first predicted payment is before period, advance to period
  let currentDate = basePrediction.expectedDate.toDate();
  const frequency = inflow.frequency as PlaidRecurringFrequency | string;

  while (currentDate < periodStart) {
    currentDate = addFrequencyInterval(currentDate, frequency);
  }

  // Collect all payments within the period
  while (currentDate <= periodEnd) {
    const prediction: PaymentPrediction = {
      expectedDate: Timestamp.fromDate(currentDate),
      expectedAmount: basePrediction.expectedAmount,
      confidenceLevel: basePrediction.confidenceLevel,
      predictionMethod: basePrediction.predictionMethod,
      isInPeriod: true,
      daysUntilPayment: Math.ceil(
        (currentDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      )
    };

    predictions.push(prediction);
    currentDate = addFrequencyInterval(currentDate, frequency);
  }

  console.log(
    `[predictPaymentsInPeriod] Inflow: ${inflow.description || inflow.id}, ` +
    `Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}, ` +
    `Payments: ${predictions.length}`
  );

  return predictions;
}

export default predictNextPayment;
