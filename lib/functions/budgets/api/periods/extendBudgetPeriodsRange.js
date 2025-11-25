"use strict";
/**
 * Extend Budget Periods Range
 *
 * This callable function extends budget_periods for multiple periods at once
 * to improve performance when users are scrolling through periods. Instead of
 * creating periods one-at-a-time, this function creates them in batches.
 *
 * Features:
 * - Batch period generation (create multiple periods in one call)
 * - Smart period selection (only creates missing periods)
 * - Handles all period types (weekly, bi-monthly, monthly)
 * - User permission validation
 * - Efficient batch writes
 *
 * Memory: 512MiB, Timeout: 60s (increased for batch processing)
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
exports.extendBudgetPeriodsRange = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const auth_1 = require("../../../../utils/auth");
const budgetPeriods_1 = require("../../utils/budgetPeriods");
const calculatePeriodAllocatedAmount_1 = require("../../utils/calculatePeriodAllocatedAmount");
/**
 * Extend budget periods to cover a range of periods
 * Called proactively when frontend detects user approaching periods without budget data
 */
exports.extendBudgetPeriodsRange = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (request) => {
    try {
        const { startPeriodId, endPeriodId, periodType, familyId, maxPeriods = 20 } = request.data;
        // Authenticate user
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.VIEWER);
        if (!user || !userData) {
            throw new Error('Authentication required');
        }
        const db = admin.firestore();
        console.log(`Extending budget periods range: ${startPeriodId} to ${endPeriodId} (${periodType}) for user: ${user.uid}`);
        // Get all source periods in the requested range
        const sourcePeriodsQuery = await db.collection('source_periods')
            .where('type', '==', periodType)
            .where('id', '>=', startPeriodId)
            .where('id', '<=', endPeriodId)
            .orderBy('id')
            .limit(maxPeriods)
            .get();
        if (sourcePeriodsQuery.empty) {
            throw new Error(`No source periods found in range: ${startPeriodId} to ${endPeriodId}`);
        }
        const sourcePeriods = sourcePeriodsQuery.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        console.log(`Found ${sourcePeriods.length} source periods in range`);
        // Find active budgets that need extension
        let budgetsQuery = db.collection('budgets')
            .where('isActive', '==', true);
        if (familyId) {
            budgetsQuery = budgetsQuery.where('familyId', '==', familyId);
        }
        else {
            budgetsQuery = budgetsQuery.where('createdBy', '==', user.uid);
        }
        const budgetsSnapshot = await budgetsQuery.get();
        if (budgetsSnapshot.empty) {
            console.log('No active budgets found to extend');
            return {
                success: true,
                budgetPeriodsCreated: 0,
                budgetsExtended: [],
                periodsProcessed: sourcePeriods.map(p => p.id),
                skippedPeriods: [],
            };
        }
        const budgets = budgetsSnapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        console.log(`Found ${budgets.length} active budgets to potentially extend`);
        // Check which budget periods already exist to avoid duplicates
        const existingPeriodsQuery = await db.collection('budget_periods')
            .where('userId', '==', user.uid)
            .where('periodType', '==', periodType)
            .where('periodId', 'in', sourcePeriods.map(p => p.id))
            .get();
        const existingPeriodIds = new Set();
        existingPeriodsQuery.docs.forEach(doc => {
            const data = doc.data();
            existingPeriodIds.add(`${data.budgetId}_${data.periodId}`);
        });
        const budgetPeriodsToCreate = [];
        const budgetsToExtend = new Set();
        const skippedPeriods = [];
        const now = admin.firestore.Timestamp.now();
        // Create budget periods for each combination of budget and period
        for (const budget of budgets) {
            for (const sourcePeriod of sourcePeriods) {
                const budgetPeriodKey = `${budget.id}_${sourcePeriod.id}`;
                // Skip if this budget period already exists
                if (existingPeriodIds.has(budgetPeriodKey)) {
                    skippedPeriods.push(sourcePeriod.id);
                    continue;
                }
                // Check if this period falls within the budget's timeframe
                if (sourcePeriod.startDate.toMillis() < budget.startDate.toMillis() ||
                    (budget.endDate && sourcePeriod.endDate.toMillis() > budget.endDate.toMillis())) {
                    console.log(`Period ${sourcePeriod.id} is outside budget ${budget.id} timeframe, skipping`);
                    continue;
                }
                budgetsToExtend.add(budget.id);
                // Calculate allocated amount based on actual days in period
                // Convert budget.period (BudgetPeriod) to PeriodType for calculation
                const budgetPeriodType = budget.period === 'monthly' ? types_1.PeriodType.MONTHLY :
                    budget.period === 'weekly' ? types_1.PeriodType.WEEKLY :
                        types_1.PeriodType.MONTHLY; // Default to monthly for other types
                const allocatedAmount = (0, calculatePeriodAllocatedAmount_1.calculatePeriodAllocatedAmount)(budget.amount, budgetPeriodType, sourcePeriod);
                const budgetPeriod = {
                    id: `${budget.id}_${sourcePeriod.id}`,
                    budgetId: budget.id,
                    periodId: sourcePeriod.id,
                    sourcePeriodId: sourcePeriod.id, // Direct reference to source_periods.id for mapping
                    familyId: String(budget.familyId || userData.familyId || ''),
                    // Ownership
                    userId: budget.createdBy,
                    createdBy: budget.createdBy,
                    // Period context
                    periodType: sourcePeriod.type,
                    periodStart: sourcePeriod.startDate,
                    periodEnd: sourcePeriod.endDate,
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
        }
        if (budgetPeriodsToCreate.length === 0) {
            console.log('No budget periods need to be created');
            return {
                success: true,
                budgetPeriodsCreated: 0,
                budgetsExtended: [],
                periodsProcessed: sourcePeriods.map(p => p.id),
                skippedPeriods: [...new Set(skippedPeriods)],
            };
        }
        console.log(`Creating ${budgetPeriodsToCreate.length} new budget periods across ${budgetsToExtend.size} budgets`);
        // Batch create the new budget periods using centralized utility
        await (0, budgetPeriods_1.batchCreateBudgetPeriods)(db, budgetPeriodsToCreate);
        // Update budget activePeriodRange for extended budgets
        const latestPeriod = sourcePeriods[sourcePeriods.length - 1];
        const budgetUpdatePromises = Array.from(budgetsToExtend).map(async (budgetId) => {
            var _a, _b;
            const budget = budgets.find(b => b.id === budgetId);
            if (!budget)
                return;
            // Only update if this is extending beyond current range
            if (!budget.activePeriodRange ||
                latestPeriod.startDate.toMillis() >
                    ((_b = (_a = (await db.collection('source_periods').doc(budget.activePeriodRange.endPeriod).get())
                        .data()) === null || _a === void 0 ? void 0 : _a.startDate) === null || _b === void 0 ? void 0 : _b.toMillis())) {
                await db.collection('budgets').doc(budgetId).update({
                    'activePeriodRange.endPeriod': latestPeriod.id,
                    lastExtended: now,
                });
            }
        });
        await Promise.all(budgetUpdatePromises);
        console.log(`Successfully created ${budgetPeriodsToCreate.length} budget periods for ${budgetsToExtend.size} budgets`);
        return {
            success: true,
            budgetPeriodsCreated: budgetPeriodsToCreate.length,
            budgetsExtended: Array.from(budgetsToExtend),
            periodsProcessed: sourcePeriods.map(p => p.id),
            skippedPeriods: [...new Set(skippedPeriods)],
        };
    }
    catch (error) {
        console.error('Error extending budget periods range:', error);
        return {
            success: false,
            budgetPeriodsCreated: 0,
            budgetsExtended: [],
            periodsProcessed: [],
            skippedPeriods: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
//# sourceMappingURL=extendBudgetPeriodsRange.js.map