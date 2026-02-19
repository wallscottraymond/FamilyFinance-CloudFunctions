"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.predictNextPayment = predictNextPayment;
exports.predictPaymentsInPeriod = predictPaymentsInPeriod;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
/**
 * Add frequency interval to a date
 * Handles month-end dates by capping at the last day of the target month
 */
function addFrequencyInterval(date, frequency) {
    const newDate = new Date(date);
    const originalDay = date.getDate();
    switch (frequency) {
        case types_1.PlaidRecurringFrequency.WEEKLY:
        case 'WEEKLY':
            newDate.setDate(newDate.getDate() + 7);
            break;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
        case 'BIWEEKLY':
            newDate.setDate(newDate.getDate() + 14);
            break;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
        case 'SEMI_MONTHLY':
            newDate.setDate(newDate.getDate() + 15);
            break;
        case types_1.PlaidRecurringFrequency.MONTHLY:
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
        case types_1.PlaidRecurringFrequency.ANNUALLY:
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
function calculateRollingAverage(inflow, periods = 3) {
    // For now, use the average amount from Plaid/inflow
    // In the future, this could query transaction history
    return Math.abs(inflow.averageAmount || 0);
}
/**
 * Determine confidence level based on income type and prediction method
 */
function determineConfidenceLevel(inflow, predictionMethod) {
    const incomeType = inflow.incomeType;
    const isRegularSalary = inflow.isRegularSalary;
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
    // Low confidence: Commission or bonus without specific config
    if (incomeType === 'commission' || incomeType === 'bonus') {
        return 'low';
    }
    // Default to medium
    return 'medium';
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
function predictNextPayment(inflow, fromDate = new Date()) {
    // Handle inactive income - don't predict payments
    if (inflow.isActive === false) {
        return null;
    }
    let expectedDate;
    let expectedAmount;
    let predictionMethod;
    // Cast to access extended properties
    const inflowExtended = inflow;
    // Step 1: Determine expected date
    // Priority: Plaid's predictedNextDate > frequency calculation from lastDate
    if (inflow.predictedNextDate) {
        expectedDate = inflow.predictedNextDate.toDate();
        predictionMethod = 'plaid';
        // If predicted date is in the past, calculate forward
        if (expectedDate < fromDate) {
            const frequency = inflow.frequency;
            while (expectedDate < fromDate) {
                expectedDate = addFrequencyInterval(expectedDate, frequency);
            }
            predictionMethod = 'frequency';
        }
    }
    else if (inflow.lastDate) {
        // Calculate from last date using frequency
        const frequency = inflow.frequency;
        expectedDate = inflow.lastDate.toDate();
        while (expectedDate < fromDate) {
            expectedDate = addFrequencyInterval(expectedDate, frequency);
        }
        predictionMethod = 'frequency';
    }
    else if (inflow.firstDate) {
        // Fallback to first date
        const frequency = inflow.frequency;
        expectedDate = inflow.firstDate.toDate();
        while (expectedDate < fromDate) {
            expectedDate = addFrequencyInterval(expectedDate, frequency);
        }
        predictionMethod = 'frequency';
    }
    else {
        // No date available - return prediction for 30 days from now
        expectedDate = new Date(fromDate);
        expectedDate.setDate(expectedDate.getDate() + 30);
        predictionMethod = 'frequency';
    }
    // Step 2: Determine expected amount
    // Priority: User override > Rolling average > Plaid average
    const variableConfig = inflowExtended.variableIncomeConfig;
    if ((variableConfig === null || variableConfig === void 0 ? void 0 : variableConfig.userOverrideAmount) != null && variableConfig.userOverrideAmount > 0) {
        // User has set an override amount
        expectedAmount = variableConfig.userOverrideAmount;
        predictionMethod = 'user_override';
    }
    else if (inflowExtended.isVariable && (variableConfig === null || variableConfig === void 0 ? void 0 : variableConfig.useRollingAverage)) {
        // Use rolling average for variable income
        const periods = variableConfig.rollingAveragePeriods || 3;
        expectedAmount = calculateRollingAverage(inflow, periods);
        if (predictionMethod !== 'plaid') {
            predictionMethod = 'rolling_average';
        }
    }
    else {
        // Use average amount (always positive)
        expectedAmount = Math.abs(inflow.averageAmount || 0);
    }
    // Calculate days until payment
    const daysUntilPayment = Math.ceil((expectedDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    // Determine confidence level
    const confidenceLevel = determineConfidenceLevel(inflow, predictionMethod);
    // isInPeriod defaults to true (caller can check against their specific period)
    const isInPeriod = true;
    console.log(`[predictNextPayment] Inflow: ${inflow.description || inflow.id}, ` +
        `Expected: ${expectedDate.toISOString().split('T')[0]}, ` +
        `Amount: $${expectedAmount.toFixed(2)}, ` +
        `Method: ${predictionMethod}, Confidence: ${confidenceLevel}`);
    return {
        expectedDate: firestore_1.Timestamp.fromDate(expectedDate),
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
function predictPaymentsInPeriod(inflow, periodStart, periodEnd) {
    const predictions = [];
    // Get base prediction for first payment
    const basePrediction = predictNextPayment(inflow, new Date(periodStart.getTime() - 86400000)); // Day before period start
    // If inactive income (returns null), return empty array
    if (!basePrediction) {
        return predictions;
    }
    // If first predicted payment is before period, advance to period
    let currentDate = basePrediction.expectedDate.toDate();
    const frequency = inflow.frequency;
    while (currentDate < periodStart) {
        currentDate = addFrequencyInterval(currentDate, frequency);
    }
    // Collect all payments within the period
    while (currentDate <= periodEnd) {
        const prediction = {
            expectedDate: firestore_1.Timestamp.fromDate(currentDate),
            expectedAmount: basePrediction.expectedAmount,
            confidenceLevel: basePrediction.confidenceLevel,
            predictionMethod: basePrediction.predictionMethod,
            isInPeriod: true,
            daysUntilPayment: Math.ceil((currentDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        };
        predictions.push(prediction);
        currentDate = addFrequencyInterval(currentDate, frequency);
    }
    console.log(`[predictPaymentsInPeriod] Inflow: ${inflow.description || inflow.id}, ` +
        `Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}, ` +
        `Payments: ${predictions.length}`);
    return predictions;
}
exports.default = predictNextPayment;
//# sourceMappingURL=predictNextPayment.js.map