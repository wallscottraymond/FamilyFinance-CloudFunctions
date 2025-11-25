"use strict";
/**
 * Budget Periods Utility
 *
 * Centralized logic for creating and managing budget periods.
 * Handles the creation of budget_periods from source_periods with proper amount allocation.
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
exports.createBudgetPeriodsFromSource = createBudgetPeriodsFromSource;
exports.batchCreateBudgetPeriods = batchCreateBudgetPeriods;
exports.updateBudgetPeriodRange = updateBudgetPeriodRange;
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../types");
const calculatePeriodAllocatedAmount_1 = require("../functions/budgets/utils/calculatePeriodAllocatedAmount");
/**
 * Create budget periods from source periods
 *
 * Queries source_periods collection and creates budget_periods with proper amount allocation:
 * - Monthly: Full budget amount
 * - Bi-Monthly: Half budget amount (50%)
 * - Weekly: Proportional amount (7/30.44 of monthly)
 */
async function createBudgetPeriodsFromSource(db, budgetId, budget, startDate, endDate) {
    console.log(`[budgetPeriods] Creating budget periods for budget ${budgetId} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    // Query source_periods
    const sourcePeriodsQuery = db.collection('source_periods')
        .where('startDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
        .where('startDate', '<=', admin.firestore.Timestamp.fromDate(endDate));
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    if (sourcePeriodsSnapshot.empty) {
        throw new Error(`No source periods found in date range ${startDate.toISOString()} to ${endDate.toISOString()}. Please run generateSourcePeriods admin function.`);
    }
    console.log(`[budgetPeriods] Found ${sourcePeriodsSnapshot.size} source periods to process`);
    const now = admin.firestore.Timestamp.now();
    const budgetPeriods = [];
    const counts = {
        weekly: 0,
        biMonthly: 0,
        monthly: 0,
    };
    // Create budget_periods from source_periods
    sourcePeriodsSnapshot.forEach((doc) => {
        const sourcePeriod = Object.assign({ id: doc.id }, doc.data());
        // Calculate allocated amount based on actual days in period
        // Convert budget.period (BudgetPeriod) to PeriodType for calculation
        const budgetPeriodType = budget.period === 'monthly' ? types_1.PeriodType.MONTHLY :
            budget.period === 'weekly' ? types_1.PeriodType.WEEKLY :
                types_1.PeriodType.MONTHLY; // Default to monthly for other types
        const allocatedAmount = (0, calculatePeriodAllocatedAmount_1.calculatePeriodAllocatedAmount)(budget.amount, budgetPeriodType, sourcePeriod);
        const budgetPeriod = {
            id: `${budgetId}_${sourcePeriod.periodId}`,
            budgetId: budgetId,
            periodId: sourcePeriod.periodId,
            sourcePeriodId: sourcePeriod.periodId,
            familyId: String(budget.familyId || ''),
            userId: budget.createdBy,
            createdBy: budget.createdBy,
            periodType: sourcePeriod.type,
            periodStart: sourcePeriod.startDate,
            periodEnd: sourcePeriod.endDate,
            allocatedAmount,
            originalAmount: allocatedAmount,
            budgetName: budget.name,
            checklistItems: [],
            isModified: false,
            createdAt: now,
            updatedAt: now,
            lastCalculated: now,
            isActive: true,
        };
        budgetPeriods.push(budgetPeriod);
        // Track counts by period type
        if (sourcePeriod.type === types_1.PeriodType.WEEKLY) {
            counts.weekly++;
        }
        else if (sourcePeriod.type === types_1.PeriodType.BI_MONTHLY) {
            counts.biMonthly++;
        }
        else if (sourcePeriod.type === types_1.PeriodType.MONTHLY) {
            counts.monthly++;
        }
    });
    // Sort by period start to get first and last periods
    const sortedPeriods = [...budgetPeriods].sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());
    const result = {
        budgetPeriods,
        count: budgetPeriods.length,
        periodTypeCounts: counts,
        firstPeriodId: sortedPeriods[0].periodId,
        lastPeriodId: sortedPeriods[sortedPeriods.length - 1].periodId,
    };
    console.log(`[budgetPeriods] Created ${result.count} budget periods:`, {
        weekly: counts.weekly,
        biMonthly: counts.biMonthly,
        monthly: counts.monthly,
    });
    return result;
}
/**
 * Batch create budget periods in Firestore
 *
 * Efficiently creates multiple budget_periods using batch operations.
 * Handles Firestore's 500 document batch limit.
 */
async function batchCreateBudgetPeriods(db, budgetPeriods) {
    const BATCH_SIZE = 500; // Firestore batch limit
    console.log(`[budgetPeriods] Batch creating ${budgetPeriods.length} budget periods`);
    for (let i = 0; i < budgetPeriods.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchPeriods = budgetPeriods.slice(i, i + BATCH_SIZE);
        batchPeriods.forEach((budgetPeriod) => {
            const docRef = db.collection('budget_periods').doc(budgetPeriod.id);
            batch.set(docRef, budgetPeriod);
        });
        await batch.commit();
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(budgetPeriods.length / BATCH_SIZE);
        console.log(`[budgetPeriods] Created batch ${batchNumber}/${totalBatches} (${batchPeriods.length} periods)`);
    }
    console.log(`[budgetPeriods] Successfully created ${budgetPeriods.length} budget periods`);
}
/**
 * Update budget with period range metadata
 */
async function updateBudgetPeriodRange(db, budgetId, firstPeriodId, lastPeriodId, endDate, isRecurring) {
    const updateData = {
        activePeriodRange: {
            startPeriod: firstPeriodId,
            endPeriod: lastPeriodId,
        },
        lastExtended: admin.firestore.Timestamp.now(),
    };
    // Add metadata for recurring budgets to enable future extension
    if (isRecurring) {
        updateData.periodsGeneratedUntil = admin.firestore.Timestamp.fromDate(endDate);
        updateData.canExtendPeriods = true;
        updateData.needsScheduledExtension = true; // Flag for scheduled function
    }
    await db.collection('budgets').doc(budgetId).update(updateData);
    console.log(`[budgetPeriods] Updated budget ${budgetId} with period range:`, {
        startPeriod: firstPeriodId,
        endPeriod: lastPeriodId,
        isRecurring,
    });
}
//# sourceMappingURL=budgetPeriods.js.map