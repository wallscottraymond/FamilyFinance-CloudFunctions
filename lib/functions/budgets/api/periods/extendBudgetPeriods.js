"use strict";
/**
 * Extend Budget Periods (Simplified)
 *
 * This callable function handles rare cases where budget periods need to be created
 * for existing budgets. Since periods are now created upfront, this should rarely be needed.
 *
 * Features:
 * - Simple period generation for edge cases
 * - Handles single period requests
 * - User permission validation
 *
 * Memory: 256MiB, Timeout: 30s
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
exports.extendBudgetPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const auth_1 = require("../../../../utils/auth");
const budgetPeriods_1 = require("../../utils/budgetPeriods");
const calculatePeriodAllocatedAmount_1 = require("../../utils/calculatePeriodAllocatedAmount");
/**
 * Extend budget periods to cover a specific period
 * Called when frontend needs budget data for a period that doesn't exist yet
 */
exports.extendBudgetPeriods = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    var _a, _b;
    try {
        const { periodId, familyId } = request.data;
        // Authenticate user
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.VIEWER);
        if (!user || !userData) {
            throw new Error('Authentication required');
        }
        const db = admin.firestore();
        console.log(`Creating budget periods for period: ${periodId} for user: ${user.uid}`);
        // Get the target source period
        const targetPeriodDoc = await db.collection('source_periods').doc(periodId).get();
        if (!targetPeriodDoc.exists) {
            throw new Error(`Source period not found: ${periodId}`);
        }
        const targetPeriod = Object.assign({ id: targetPeriodDoc.id }, targetPeriodDoc.data());
        // Find active budgets that need extension
        let budgetsQuery = db.collection('budgets')
            .where('isActive', '==', true);
        if (familyId) {
            // If familyId provided, get family budgets
            budgetsQuery = budgetsQuery.where('familyId', '==', familyId);
        }
        else {
            // Otherwise get user's personal budgets
            budgetsQuery = budgetsQuery.where('createdBy', '==', user.uid);
        }
        const budgetsSnapshot = await budgetsQuery.get();
        if (budgetsSnapshot.empty) {
            console.log('No active budgets found');
            return {
                success: true,
                budgetPeriodsCreated: 0,
                budgetsExtended: [],
            };
        }
        console.log(`Found ${budgetsSnapshot.size} active budgets`);
        const budgetsToExtend = [];
        const budgetPeriodsToCreate = [];
        const now = admin.firestore.Timestamp.now();
        // Check each budget to see if it needs this period
        for (const budgetDoc of budgetsSnapshot.docs) {
            const budget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
            // Check if this budget already has this period
            const existingPeriodQuery = await db.collection('budget_periods')
                .where('budgetId', '==', budget.id)
                .where('periodId', '==', periodId)
                .get();
            if (!existingPeriodQuery.empty) {
                console.log(`Budget ${budget.id} already has period ${periodId}, skipping`);
                continue;
            }
            // Check if this period falls within the budget's timeframe
            const budgetStartTime = budget.startDate.toMillis();
            const periodStartTime = targetPeriod.startDate.toMillis();
            // Skip if period starts before budget starts
            if (periodStartTime < budgetStartTime) {
                console.log(`Period ${periodId} starts before budget ${budget.id} start date, skipping`);
                continue;
            }
            // Check budget end date based on isOngoing flag
            if (!budget.isOngoing && budget.budgetEndDate) {
                const budgetEndTime = budget.budgetEndDate.toMillis();
                if (periodStartTime > budgetEndTime) {
                    console.log(`Period ${periodId} starts after budget ${budget.id} end date, skipping`);
                    continue;
                }
            }
            budgetsToExtend.push(budget);
            // Calculate allocated amount based on actual days in period
            // Convert budget.period (BudgetPeriod) to PeriodType for calculation
            const budgetPeriodType = budget.period === 'monthly' ? types_1.PeriodType.MONTHLY :
                budget.period === 'weekly' ? types_1.PeriodType.WEEKLY :
                    types_1.PeriodType.MONTHLY; // Default to monthly for other types
            const allocatedAmount = (0, calculatePeriodAllocatedAmount_1.calculatePeriodAllocatedAmount)(budget.amount, budgetPeriodType, targetPeriod);
            const budgetPeriod = {
                id: `${budget.id}_${targetPeriod.id}`,
                budgetId: budget.id,
                periodId: targetPeriod.id,
                sourcePeriodId: targetPeriod.id,
                familyId: String(budget.familyId || userData.familyId || ''),
                // Ownership
                userId: budget.createdBy,
                createdBy: budget.createdBy,
                // Period context
                periodType: targetPeriod.type,
                periodStart: targetPeriod.startDate,
                periodEnd: targetPeriod.endDate,
                // Budget amounts
                allocatedAmount,
                originalAmount: allocatedAmount,
                // Budget name (denormalized for performance)
                budgetName: budget.name,
                // Checklist items (initially empty)
                checklistItems: [],
                // User modifications
                isModified: false,
                // System fields
                createdAt: now,
                updatedAt: now,
                lastCalculated: now,
                isActive: true,
            };
            budgetPeriodsToCreate.push(budgetPeriod);
        }
        if (budgetPeriodsToCreate.length === 0) {
            console.log('No budget periods need to be created');
            return {
                success: true,
                budgetPeriodsCreated: 0,
                budgetsExtended: [],
            };
        }
        console.log(`Creating ${budgetPeriodsToCreate.length} new budget periods`);
        // Batch create the new budget periods
        await (0, budgetPeriods_1.batchCreateBudgetPeriods)(db, budgetPeriodsToCreate);
        // Update budget lastExtended timestamp
        for (const budget of budgetsToExtend) {
            const updateData = { lastExtended: now };
            // For single period extension, update the range if needed
            if (!budget.activePeriodRange) {
                updateData.activePeriodRange = {
                    startPeriod: targetPeriod.id,
                    endPeriod: targetPeriod.id,
                };
            }
            else {
                // Check if this period extends the current range
                const currentEndPeriodDoc = await db.collection('source_periods').doc(budget.activePeriodRange.endPeriod).get();
                const currentEndTime = ((_b = (_a = currentEndPeriodDoc.data()) === null || _a === void 0 ? void 0 : _a.startDate) === null || _b === void 0 ? void 0 : _b.toMillis()) || 0;
                if (targetPeriod.startDate.toMillis() > currentEndTime) {
                    updateData['activePeriodRange.endPeriod'] = targetPeriod.id;
                }
            }
            await db.collection('budgets').doc(budget.id).update(updateData);
        }
        console.log(`Successfully created ${budgetPeriodsToCreate.length} budget periods`);
        return {
            success: true,
            budgetPeriodsCreated: budgetPeriodsToCreate.length,
            budgetsExtended: budgetsToExtend.map(b => b.id),
        };
    }
    catch (error) {
        console.error('Error extending budget periods:', error);
        return {
            success: false,
            budgetPeriodsCreated: 0,
            budgetsExtended: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
//# sourceMappingURL=extendBudgetPeriods.js.map