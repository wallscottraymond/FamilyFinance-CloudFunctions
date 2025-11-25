"use strict";
/**
 * Scheduled Budget Period Maintenance (Simplified)
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of budget periods for recurring budgets. Simple and efficient.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC
 * - Maintains 1-year rolling window for recurring budgets
 * - Processes all period types (weekly, bi-monthly, monthly)
 * - Simplified logic with consistent behavior
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
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
exports.extendRecurringBudgetPeriods = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const calculatePeriodAllocatedAmount_1 = require("../../utils/calculatePeriodAllocatedAmount");
/**
 * Scheduled function to extend recurring budget periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
exports.extendRecurringBudgetPeriods = (0, scheduler_1.onSchedule)({
    schedule: '0 2 1 * *', // Cron: minute hour day month dayOfWeek
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
}, async (event) => {
    console.log('🚀 Starting scheduled budget period extension...');
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    try {
        // Get all recurring budgets that are ongoing
        const recurringBudgetsQuery = db.collection('budgets')
            .where('budgetType', '==', 'recurring')
            .where('isOngoing', '==', true)
            .where('isActive', '==', true);
        const recurringBudgetsSnapshot = await recurringBudgetsQuery.get();
        if (recurringBudgetsSnapshot.empty) {
            console.log('✅ No recurring budgets found to maintain');
            return;
        }
        console.log(`📊 Found ${recurringBudgetsSnapshot.size} recurring budgets to maintain`);
        let totalPeriodsCreated = 0;
        let budgetsProcessed = 0;
        // Simple rolling window: always maintain 1 year from today
        const today = new Date();
        const oneYearFromToday = new Date(today);
        oneYearFromToday.setMonth(oneYearFromToday.getMonth() + 12);
        console.log(`🎯 Maintaining 1-year window: ${today.toISOString()} to ${oneYearFromToday.toISOString()}`);
        // Get all source periods for the rolling window
        const sourcePeriodsQuery = db.collection('source_periods')
            .where('startDate', '>=', admin.firestore.Timestamp.fromDate(today))
            .where('startDate', '<=', admin.firestore.Timestamp.fromDate(oneYearFromToday));
        const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
        if (sourcePeriodsSnapshot.empty) {
            console.warn('⚠️ No source periods found in rolling window - may need source period generation');
            return;
        }
        console.log(`📋 Found ${sourcePeriodsSnapshot.size} source periods in rolling window`);
        const sourcePeriods = sourcePeriodsSnapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        // Process each recurring budget
        for (const budgetDoc of recurringBudgetsSnapshot.docs) {
            const budget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
            try {
                console.log(`🔄 Processing budget: ${budget.name} (${budget.id})`);
                // Get existing budget periods for this budget
                const existingPeriodsQuery = db.collection('budget_periods')
                    .where('budgetId', '==', budget.id);
                const existingPeriodsSnapshot = await existingPeriodsQuery.get();
                const existingPeriodIds = new Set(existingPeriodsSnapshot.docs.map(doc => doc.data().sourcePeriodId || doc.data().periodId));
                // Find missing periods in the rolling window
                const newBudgetPeriods = [];
                sourcePeriods.forEach((sourcePeriod) => {
                    // Skip if budget period already exists
                    if (existingPeriodIds.has(sourcePeriod.id)) {
                        return;
                    }
                    // For recurring ongoing budgets, we always create periods in the rolling window
                    // No need for complex end date logic since these are ongoing
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
                        sourcePeriodId: sourcePeriod.id,
                        familyId: String(budget.familyId || ''),
                        // Ownership
                        userId: budget.createdBy,
                        createdBy: budget.createdBy,
                        // Period context (denormalized for performance)
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
                        // User modifications (initially none)
                        isModified: false,
                        // System fields
                        createdAt: now,
                        updatedAt: now,
                        lastCalculated: now,
                        isActive: true,
                    };
                    newBudgetPeriods.push(budgetPeriod);
                });
                if (newBudgetPeriods.length === 0) {
                    console.log(`✅ No new periods needed for budget ${budget.id}`);
                    budgetsProcessed++;
                    continue;
                }
                console.log(`🔨 Creating ${newBudgetPeriods.length} new budget periods for budget ${budget.id}`);
                // Batch create the new budget periods
                await batchCreateBudgetPeriods(db, newBudgetPeriods);
                // Simply update last extended timestamp - no complex range tracking needed
                await db.collection('budgets').doc(budget.id).update({
                    lastExtended: now,
                });
                totalPeriodsCreated += newBudgetPeriods.length;
                budgetsProcessed++;
                console.log(`✅ Successfully extended budget ${budget.id} with ${newBudgetPeriods.length} new periods`);
            }
            catch (error) {
                console.error(`❌ Error processing budget ${budget.id}:`, error);
                // Continue processing other budgets
            }
        }
        // Log final summary
        console.log(`🎯 Maintenance complete:`);
        console.log(`   - Budgets processed: ${budgetsProcessed}`);
        console.log(`   - Total periods created: ${totalPeriodsCreated}`);
    }
    catch (error) {
        console.error('❌ Fatal error in scheduled budget period extension:', error);
        throw error; // Re-throw to mark the function execution as failed
    }
});
/**
 * Efficiently create multiple budget_periods using Firestore batch operations
 */
async function batchCreateBudgetPeriods(db, budgetPeriods) {
    const BATCH_SIZE = 500; // Firestore batch limit
    for (let i = 0; i < budgetPeriods.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchPeriods = budgetPeriods.slice(i, i + BATCH_SIZE);
        batchPeriods.forEach((budgetPeriod) => {
            const docRef = db.collection('budget_periods').doc(budgetPeriod.id);
            batch.set(docRef, budgetPeriod);
        });
        await batch.commit();
        console.log(`📦 Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
    }
}
//# sourceMappingURL=extendRecurringBudgetPeriods.js.map