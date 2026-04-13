"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateInflowConfiguration = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
/**
 * Get the default variability for an income type
 */
function getDefaultVariability(incomeType) {
    switch (incomeType) {
        case types_1.IncomeType.SALARY:
        case types_1.IncomeType.PENSION:
            return types_1.IncomeVariability.FIXED;
        case types_1.IncomeType.RENTAL:
        case types_1.IncomeType.GOVERNMENT:
            return types_1.IncomeVariability.LOW;
        case types_1.IncomeType.HOURLY:
        case types_1.IncomeType.BASE_PLUS_COMMISSION:
        case types_1.IncomeType.INVESTMENT:
            return types_1.IncomeVariability.MEDIUM;
        case types_1.IncomeType.COMMISSION_ONLY:
        case types_1.IncomeType.BONUS:
        case types_1.IncomeType.FREELANCE:
            return types_1.IncomeVariability.HIGH;
        default:
            return types_1.IncomeVariability.MEDIUM;
    }
}
/**
 * Calculate prediction confidence based on income type
 */
function getPredictionConfidence(incomeType) {
    switch (incomeType) {
        case types_1.IncomeType.SALARY:
        case types_1.IncomeType.PENSION:
        case types_1.IncomeType.GOVERNMENT:
        case types_1.IncomeType.RENTAL:
            return 'high';
        case types_1.IncomeType.HOURLY:
        case types_1.IncomeType.BASE_PLUS_COMMISSION:
        case types_1.IncomeType.INVESTMENT:
            return 'medium';
        case types_1.IncomeType.COMMISSION_ONLY:
        case types_1.IncomeType.BONUS:
        case types_1.IncomeType.FREELANCE:
        case types_1.IncomeType.OTHER:
            return 'low';
        default:
            return 'medium';
    }
}
/**
 * Calculate expected amount based on income type and configuration
 */
function calculateExpectedAmount(incomeType, averageAmount, config) {
    var _a, _b, _c;
    switch (incomeType) {
        case types_1.IncomeType.SALARY:
        case types_1.IncomeType.PENSION:
        case types_1.IncomeType.GOVERNMENT:
        case types_1.IncomeType.RENTAL:
            // Fixed income types use the average amount
            return averageAmount;
        case types_1.IncomeType.HOURLY:
            if (config.hourlyConfig) {
                const { hourlyRate, expectedHoursPerPeriod, includeOvertime, overtimeRate, expectedOvertimeHours } = config.hourlyConfig;
                let total = hourlyRate * expectedHoursPerPeriod;
                if (includeOvertime && overtimeRate && expectedOvertimeHours) {
                    total += hourlyRate * overtimeRate * expectedOvertimeHours;
                }
                return Math.round(total * 100) / 100;
            }
            return averageAmount;
        case types_1.IncomeType.BASE_PLUS_COMMISSION:
            if (config.commissionConfig) {
                const baseAmount = config.commissionConfig.baseAmount || 0;
                const targetCommission = config.commissionConfig.targetCommission || 0;
                return baseAmount + targetCommission;
            }
            return averageAmount;
        case types_1.IncomeType.COMMISSION_ONLY:
            // Use rolling average or user override
            if (((_a = config.variableConfig) === null || _a === void 0 ? void 0 : _a.userOverrideAmount) != null) {
                return config.variableConfig.userOverrideAmount;
            }
            // Otherwise use the existing average
            return averageAmount;
        case types_1.IncomeType.BONUS:
            // Use last bonus amount if available
            if ((_b = config.bonusConfig) === null || _b === void 0 ? void 0 : _b.lastBonusAmount) {
                return config.bonusConfig.lastBonusAmount;
            }
            return averageAmount;
        case types_1.IncomeType.FREELANCE:
        case types_1.IncomeType.INVESTMENT:
        case types_1.IncomeType.OTHER:
            // Use user override or rolling average
            if (((_c = config.variableConfig) === null || _c === void 0 ? void 0 : _c.userOverrideAmount) != null) {
                return config.variableConfig.userOverrideAmount;
            }
            return averageAmount;
        default:
            return averageAmount;
    }
}
exports.updateInflowConfiguration = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (request) => {
    // Verify authentication
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userId = request.auth.uid;
    const data = request.data;
    const { inflowId, incomeType, incomeVariability, hourlyConfig, commissionConfig, bonusConfig, variableConfig } = data;
    // Validate required fields
    if (!inflowId) {
        throw new https_1.HttpsError('invalid-argument', 'inflowId is required');
    }
    if (!incomeType) {
        throw new https_1.HttpsError('invalid-argument', 'incomeType is required');
    }
    // Validate income type is valid enum value
    if (!Object.values(types_1.IncomeType).includes(incomeType)) {
        throw new https_1.HttpsError('invalid-argument', `Invalid incomeType: ${incomeType}`);
    }
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
    console.log(`[updateInflowConfiguration] Starting for inflowId: ${inflowId}, incomeType: ${incomeType}`);
    try {
        // Get the inflow document
        const inflowRef = db.collection('inflows').doc(inflowId);
        const inflowDoc = await inflowRef.get();
        if (!inflowDoc.exists) {
            throw new https_1.HttpsError('not-found', `Inflow ${inflowId} not found`);
        }
        const inflowData = inflowDoc.data();
        // Verify ownership
        if (inflowData.ownerId !== userId) {
            throw new https_1.HttpsError('permission-denied', 'You can only update your own inflows');
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
        const inflowUpdate = {
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
        if (incomeType === types_1.IncomeType.HOURLY && hourlyConfig) {
            inflowUpdate.hourlyConfig = hourlyConfig;
        }
        else if ((incomeType === types_1.IncomeType.BASE_PLUS_COMMISSION || incomeType === types_1.IncomeType.COMMISSION_ONLY) && commissionConfig) {
            inflowUpdate.commissionConfig = commissionConfig;
        }
        else if (incomeType === types_1.IncomeType.BONUS && bonusConfig) {
            inflowUpdate.bonusConfig = bonusConfig;
        }
        else if (variableConfig) {
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
            const periodData = periodDoc.data();
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
            const periodUpdate = {
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
    }
    catch (error) {
        console.error('[updateInflowConfiguration] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to update inflow configuration');
    }
});
//# sourceMappingURL=updateInflowConfiguration.js.map