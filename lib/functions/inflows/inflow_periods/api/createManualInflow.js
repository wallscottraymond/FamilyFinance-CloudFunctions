"use strict";
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
exports.createManualInflow = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const feature_flags_1 = require("../../../infrastructure/feature_flags");
const manual_inflow_service_1 = require("../../../domain/recurring/manual_inflow.service");
const create_manual_inflow_orchestrator_1 = require("../../../orchestrators/recurring/create_manual_inflow.orchestrator");
const types_1 = require("../../../types");
const types_2 = require("../../../../types");
/**
 * Get default variability for an income type
 */
function getDefaultVariability(incomeType) {
    switch (incomeType) {
        case types_2.IncomeType.SALARY:
        case types_2.IncomeType.PENSION:
            return types_2.IncomeVariability.FIXED;
        case types_2.IncomeType.RENTAL:
        case types_2.IncomeType.GOVERNMENT:
            return types_2.IncomeVariability.LOW;
        case types_2.IncomeType.HOURLY:
        case types_2.IncomeType.BASE_PLUS_COMMISSION:
        case types_2.IncomeType.INVESTMENT:
            return types_2.IncomeVariability.MEDIUM;
        case types_2.IncomeType.COMMISSION_ONLY:
        case types_2.IncomeType.BONUS:
        case types_2.IncomeType.FREELANCE:
            return types_2.IncomeVariability.HIGH;
        default:
            return types_2.IncomeVariability.MEDIUM;
    }
}
exports.createManualInflow = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    // Verify authentication
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;
    const data = request.data;
    // Validate required fields
    if (!data.name || data.name.trim() === "") {
        throw new https_1.HttpsError("invalid-argument", "Name is required");
    }
    if (typeof data.amount !== "number" || data.amount <= 0) {
        throw new https_1.HttpsError("invalid-argument", "Amount must be a positive number");
    }
    if (!data.frequency) {
        throw new https_1.HttpsError("invalid-argument", "Frequency is required");
    }
    if (!data.firstExpectedDate) {
        throw new https_1.HttpsError("invalid-argument", "First expected date is required");
    }
    if (!data.incomeType) {
        throw new https_1.HttpsError("invalid-argument", "Income type is required");
    }
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
    // Parse first expected date
    let firstDate;
    try {
        firstDate = new Date(data.firstExpectedDate);
        if (isNaN(firstDate.getTime())) {
            throw new Error("Invalid date");
        }
    }
    catch (_a) {
        throw new https_1.HttpsError("invalid-argument", "Invalid first expected date format");
    }
    // D43 (flag on): Add Income through the shared builder — stamped v2, the caller's own account
    // verified (a forged accountId is refused), periods generated inline. Flag off (or a schedule the
    // new path doesn't know): the legacy write below, unchanged.
    if (await (0, feature_flags_1.is_convert_to_recurring_enabled)(userId)) {
        const frequency = (0, manual_inflow_service_1.to_convert_frequency)(String(data.frequency));
        if (frequency) {
            try {
                const { inflow_id } = await (0, create_manual_inflow_orchestrator_1.create_manual_inflow_orchestrator)({ trace_id: `createManualInflow_${userId}_${Date.now()}`, span_id: "createManualInflow" }, userId, {
                    name: data.name.trim(),
                    amount: data.amount,
                    frequency,
                    first_expected_ms: firstDate.getTime(),
                    description: data.description || null,
                    income_type: String(data.incomeType),
                    is_regular_salary: data.incomeType === types_2.IncomeType.SALARY,
                    income_variability: String(data.incomeVariability || getDefaultVariability(data.incomeType)),
                    hourly_config: data.hourlyConfig,
                    commission_config: data.commissionConfig,
                    bonus_config: data.bonusConfig,
                    variable_config: data.variableConfig,
                    account_id: data.accountId || null,
                    source_transaction_id: data.sourceTransactionId || null,
                });
                return { success: true, inflowId: inflow_id, message: "Manual income created successfully. Periods were generated." };
            }
            catch (error) {
                if (error instanceof types_1.ConvertRefusedError)
                    throw new https_1.HttpsError("permission-denied", error.message);
                if (error instanceof https_1.HttpsError)
                    throw error;
                throw new https_1.HttpsError("invalid-argument", (error === null || error === void 0 ? void 0 : error.message) || "Failed to create manual inflow");
            }
        }
    }
    // Generate unique ID
    const inflowId = db.collection("inflows").doc().id;
    console.log(`[createManualInflow] Creating manual inflow: ${inflowId} for user: ${userId}`);
    try {
        // Determine variability
        const incomeVariability = data.incomeVariability || getDefaultVariability(data.incomeType);
        // Calculate predicted next date (same as first date for new income)
        const predictedNextDate = firestore_1.Timestamp.fromDate(firstDate);
        // Build inflow document
        const inflowDoc = {
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
            plaidItemId: "",
            accountId: data.accountId || "",
            // === FINANCIAL DATA ===
            lastAmount: data.amount,
            averageAmount: data.amount,
            currency: "USD",
            unofficialCurrency: null,
            // === DESCRIPTIVE INFO ===
            description: data.description || data.name,
            merchantName: data.name,
            userCustomName: data.name,
            // === TEMPORAL DATA ===
            frequency: data.frequency,
            firstDate: firestore_1.Timestamp.fromDate(firstDate),
            lastDate: firestore_1.Timestamp.fromDate(firstDate),
            predictedNextDate: predictedNextDate,
            // === CATEGORIZATION ===
            plaidPrimaryCategory: "INCOME",
            plaidDetailedCategory: "INCOME_OTHER",
            plaidCategoryId: null,
            internalPrimaryCategory: null,
            internalDetailedCategory: null,
            // === INCOME CLASSIFICATION ===
            incomeType: data.incomeType,
            incomeVariability: incomeVariability,
            isRegularSalary: data.incomeType === types_2.IncomeType.SALARY,
            isUserClassified: true,
            // === TYPE-SPECIFIC CONFIGURATION ===
            hourlyConfig: data.hourlyConfig || null,
            commissionConfig: data.commissionConfig || null,
            bonusConfig: data.bonusConfig || null,
            variableConfig: data.variableConfig || null,
            // === STATUS & CONTROL ===
            source: "manual",
            isActive: true,
            isHidden: false,
            isUserModified: false,
            plaidStatus: "MANUAL",
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
        await db.collection("inflows").doc(inflowId).set(inflowDoc);
        console.log(`[createManualInflow] Successfully created inflow: ${inflowId}`);
        // The onInflowCreated trigger will automatically generate inflow_periods
        return {
            success: true,
            inflowId,
            message: "Manual income created successfully. Periods will be generated automatically."
        };
    }
    catch (error) {
        console.error("[createManualInflow] Error:", error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", error.message || "Failed to create manual inflow");
    }
});
//# sourceMappingURL=createManualInflow.js.map