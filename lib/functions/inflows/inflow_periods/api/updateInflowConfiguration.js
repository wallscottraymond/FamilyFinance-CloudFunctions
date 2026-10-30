"use strict";
/**
 * Update Inflow Configuration Callable
 *
 * Two kinds of call:
 * - The "Regular Salary" toggle: `isRegularSalary` present → saves ONLY that flag. (The app sent
 *   its screen's default type alongside it; the type and configs are left alone — Code-Health-
 *   Review M7-H1.)
 * - A type / config edit: saves the type, its variability and the config blocks SENT (blocks not
 *   sent are kept — M2-M2). When the config implies an amount (hourly rate × hours, base +
 *   commission, …) that differs from the current expected amount, it becomes the income's
 *   expected amount (`expectedAmountOverride`), which the period page, the stored periods
 *   (runUpdateInflowPeriods via on_inflow_updated) and the extenders all follow. Period AMOUNTS
 *   are never written here; only the denormalized `incomeType` / `predictionConfidence`.
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
            return "high";
        case types_1.IncomeType.HOURLY:
        case types_1.IncomeType.BASE_PLUS_COMMISSION:
        case types_1.IncomeType.INVESTMENT:
            return "medium";
        case types_1.IncomeType.COMMISSION_ONLY:
        case types_1.IncomeType.BONUS:
        case types_1.IncomeType.FREELANCE:
        case types_1.IncomeType.OTHER:
            return "low";
        default:
            return "medium";
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
/**
 * JSON with sorted object keys, so a stored map equals the same config sent in another key order.
 */
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        const obj = value;
        return `{${Object.keys(obj).sort()
            .filter((k) => obj[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(value !== null && value !== void 0 ? value : null);
}
exports.updateInflowConfiguration = (0, https_1.onCall)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
}, async (request) => {
    var _a, _b;
    // Verify authentication
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;
    const data = request.data;
    const { inflowId, incomeType, isRegularSalary, incomeVariability, hourlyConfig, commissionConfig, bonusConfig, variableConfig, } = data;
    const isToggle = typeof isRegularSalary === "boolean";
    // Validate required fields
    if (!inflowId) {
        throw new https_1.HttpsError("invalid-argument", "inflowId is required");
    }
    if (!isToggle) {
        if (!incomeType) {
            throw new https_1.HttpsError("invalid-argument", "incomeType is required");
        }
        // Validate income type is valid enum value
        if (!Object.values(types_1.IncomeType).includes(incomeType)) {
            throw new https_1.HttpsError("invalid-argument", `Invalid incomeType: ${incomeType}`);
        }
    }
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
    const change = isToggle ? `isRegularSalary: ${isRegularSalary}` : `incomeType: ${incomeType}`;
    console.log(`[updateInflowConfiguration] Starting for inflowId: ${inflowId}, ${change}`);
    try {
        // Get the inflow document
        const inflowRef = db.collection("inflows").doc(inflowId);
        const inflowDoc = await inflowRef.get();
        if (!inflowDoc.exists) {
            throw new https_1.HttpsError("not-found", `Inflow ${inflowId} not found`);
        }
        const inflowData = inflowDoc.data();
        // Verify ownership
        if (inflowData.ownerId !== userId) {
            throw new https_1.HttpsError("permission-denied", "You can only update your own inflows");
        }
        // The income's current expected amount: the user's, else Plaid's average (as the period page).
        const currentExpected = Math.abs((_b = (_a = inflowData.expectedAmountOverride) !== null && _a !== void 0 ? _a : inflowData.averageAmount) !== null && _b !== void 0 ? _b : 0);
        if (isToggle) {
            await inflowRef.update({ isRegularSalary, updatedAt: now, updatedBy: userId });
            console.log(`[updateInflowConfiguration] Updated isRegularSalary on ${inflowId}`);
            const storedType = inflowData.incomeType || types_1.IncomeType.OTHER;
            return {
                success: true,
                inflowId,
                periodsUpdated: 0,
                newPrediction: {
                    expectedAmount: currentExpected,
                    confidence: getPredictionConfidence(storedType),
                },
            };
        }
        const type = incomeType;
        // Only a config block the user CHANGED may set the expected amount: the app sends the stored
        // blocks back on every save, and an unchanged one must not undo a later amount edit.
        const changed = (sent, stored) => sent && stableJson(sent) !== stableJson(stored !== null && stored !== void 0 ? stored : null) ? sent : undefined;
        const configExpected = calculateExpectedAmount(type, currentExpected, {
            hourlyConfig: changed(hourlyConfig, inflowData.hourlyConfig),
            commissionConfig: changed(commissionConfig, inflowData.commissionConfig),
            bonusConfig: changed(bonusConfig, inflowData.bonusConfig),
            variableConfig: changed(variableConfig, inflowData.variableConfig),
        });
        const newExpectedAmount = Math.round(configExpected * 100) / 100;
        // Determine variability (use provided or calculate default)
        const finalVariability = incomeVariability || getDefaultVariability(type);
        const predictionConfidence = getPredictionConfidence(type);
        // Build update object for inflow
        const inflowUpdate = {
            incomeType: type,
            incomeVariability: finalVariability,
            isUserClassified: true,
            updatedAt: now,
            updatedBy: userId
        };
        // Save the config blocks sent; the others stay as they were.
        if (hourlyConfig)
            inflowUpdate.hourlyConfig = hourlyConfig;
        if (commissionConfig)
            inflowUpdate.commissionConfig = commissionConfig;
        if (bonusConfig)
            inflowUpdate.bonusConfig = bonusConfig;
        if (variableConfig)
            inflowUpdate.variableConfig = variableConfig;
        // A config that implies a different amount becomes the income's expected amount.
        if (newExpectedAmount > 0 && Math.abs(newExpectedAmount - currentExpected) >= 0.005) {
            inflowUpdate.expectedAmountOverride = newExpectedAmount;
        }
        // Update the inflow document
        await inflowRef.update(inflowUpdate);
        console.log(`[updateInflowConfiguration] Updated inflow ${inflowId}`);
        // Refresh the denormalized type on its periods (amounts follow the definition's expected
        // amount through on_inflow_updated → runUpdateInflowPeriods).
        const periodsSnapshot = await db.collection("inflow_periods")
            .where("inflowId", "==", inflowId)
            .get();
        let periodsUpdated = 0;
        const batchSize = 500;
        let batch = db.batch();
        let batchCount = 0;
        for (const periodDoc of periodsSnapshot.docs) {
            const periodUpdate = {
                incomeType: type,
                predictionConfidence: predictionConfidence,
                updatedAt: now,
            };
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
        console.error("[updateInflowConfiguration] Error:", error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", error.message || "Failed to update inflow configuration");
    }
});
//# sourceMappingURL=updateInflowConfiguration.js.map