"use strict";
/**
 * Scheduled Budget Period Maintenance (Prime/Non-Prime System)
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of budget periods for recurring budgets using the Prime/Non-Prime system.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC
 * - Maintains 1-year rolling window for recurring budgets
 * - Uses Prime/Non-Prime period generation for accurate cross-period calculations
 * - Prime periods generated first, then non-prime derived from primes
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
const firestore_1 = require("firebase-admin/firestore");
const primePeriodGeneration_1 = require("../../utils/primePeriodGeneration");
const nonPrimePeriodGeneration_1 = require("../../utils/nonPrimePeriodGeneration");
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    console.log('🚀 Starting scheduled budget period extension (Prime/Non-Prime System)...');
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
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
            .where('startDate', '>=', firestore_1.Timestamp.fromDate(today))
            .where('startDate', '<=', firestore_1.Timestamp.fromDate(oneYearFromToday));
        const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
        if (sourcePeriodsSnapshot.empty) {
            console.warn('⚠️ No source periods found in rolling window - may need source period generation');
            return;
        }
        console.log(`📋 Found ${sourcePeriodsSnapshot.size} source periods in rolling window`);
        const allSourcePeriods = sourcePeriodsSnapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
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
                // Determine prime and non-prime period types
                const primePeriodType = (0, primePeriodGeneration_1.getPrimePeriodType)(budget.period);
                const nonPrimePeriodTypes = (0, primePeriodGeneration_1.getNonPrimePeriodTypes)(budget.period);
                console.log(`  Prime type: ${primePeriodType}, Non-prime types: ${nonPrimePeriodTypes.join(', ')}`);
                // Filter source periods by type
                const primeSourcePeriods = allSourcePeriods.filter(sp => sp.type === primePeriodType);
                const nonPrimeSourcePeriodsByType = new Map();
                for (const periodType of nonPrimePeriodTypes) {
                    nonPrimeSourcePeriodsByType.set(periodType, allSourcePeriods.filter(sp => sp.type === periodType));
                }
                // === PHASE 1: Generate new Prime periods ===
                const newPrimePeriods = [];
                for (const sourcePeriod of primeSourcePeriods) {
                    // Skip if budget period already exists
                    if (existingPeriodIds.has(sourcePeriod.id)) {
                        continue;
                    }
                    // Calculate days in period using UTC-normalized dates to avoid off-by-one errors
                    const periodStart = sourcePeriod.startDate.toDate();
                    const periodEnd = sourcePeriod.endDate.toDate();
                    const startUTC = Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate());
                    const endUTC = Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate());
                    const daysInPeriod = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24)) + 1;
                    // For prime periods, allocatedAmount = budget.amount (full amount for the period type)
                    const allocatedAmount = budget.amount;
                    // Store dailyRate with 6 decimal precision for accurate non-prime calculations
                    const dailyRate = Math.round((allocatedAmount / daysInPeriod) * 1000000) / 1000000;
                    const budgetPeriod = {
                        id: `${budget.id}_${sourcePeriod.id}`,
                        budgetId: budget.id,
                        periodId: sourcePeriod.id,
                        sourcePeriodId: sourcePeriod.id,
                        familyId: String(budget.familyId || ''),
                        // Ownership - inherit from budget
                        userId: ((_a = budget.access) === null || _a === void 0 ? void 0 : _a.createdBy) || budget.createdBy,
                        createdBy: ((_b = budget.access) === null || _b === void 0 ? void 0 : _b.createdBy) || budget.createdBy,
                        ownerId: ((_c = budget.access) === null || _c === void 0 ? void 0 : _c.ownerId) || budget.ownerId,
                        groupId: budget.groupId,
                        isPrivate: (_e = (_d = budget.access) === null || _d === void 0 ? void 0 : _d.isPrivate) !== null && _e !== void 0 ? _e : budget.isPrivate,
                        accessibleBy: budget.accessibleBy,
                        // Period context
                        periodType: sourcePeriod.type,
                        periodStart: sourcePeriod.startDate,
                        periodEnd: sourcePeriod.endDate,
                        // Budget amounts
                        allocatedAmount,
                        originalAmount: allocatedAmount,
                        // Budget name
                        budgetName: budget.name,
                        // Checklist items
                        checklistItems: [],
                        // User modifications
                        isModified: false,
                        // System fields
                        createdAt: now,
                        updatedAt: now,
                        lastCalculated: now,
                        isActive: true,
                        // === PRIME PERIOD FIELDS ===
                        isPrime: true,
                        dailyRate,
                        daysInPeriod,
                        primePeriodIds: [],
                        primePeriodBreakdown: [],
                    };
                    newPrimePeriods.push(budgetPeriod);
                }
                // Persist new prime periods first (CRITICAL: must complete before non-prime generation)
                if (newPrimePeriods.length > 0) {
                    console.log(`  🔨 Creating ${newPrimePeriods.length} new PRIME budget periods`);
                    await batchCreateBudgetPeriods(db, newPrimePeriods);
                }
                // === PHASE 2: Get ALL prime periods (existing + new) for non-prime calculation ===
                // We need all prime periods to correctly calculate non-prime amounts
                const allPrimePeriodsQuery = db.collection('budget_periods')
                    .where('budgetId', '==', budget.id)
                    .where('isPrime', '==', true);
                const allPrimePeriodsSnapshot = await allPrimePeriodsQuery.get();
                // Also include existing primes that might not have isPrime field (backward compat)
                const existingPrimePeriodsQuery = db.collection('budget_periods')
                    .where('budgetId', '==', budget.id)
                    .where('periodType', '==', primePeriodType);
                const existingPrimePeriodsSnapshot = await existingPrimePeriodsQuery.get();
                // Merge and deduplicate prime periods
                const primePeriodsMap = new Map();
                // Add from isPrime query
                allPrimePeriodsSnapshot.docs.forEach(doc => {
                    const period = Object.assign({ id: doc.id }, doc.data());
                    primePeriodsMap.set(doc.id, period);
                });
                // Add from periodType query (for backward compatibility)
                existingPrimePeriodsSnapshot.docs.forEach(doc => {
                    if (!primePeriodsMap.has(doc.id)) {
                        const period = Object.assign({ id: doc.id }, doc.data());
                        // Calculate dailyRate if not present (with 6 decimal precision)
                        if (!period.dailyRate && period.allocatedAmount) {
                            // Use UTC-normalized dates to avoid off-by-one errors
                            const pStart = period.periodStart.toDate();
                            const pEnd = period.periodEnd.toDate();
                            const pStartUTC = Date.UTC(pStart.getUTCFullYear(), pStart.getUTCMonth(), pStart.getUTCDate());
                            const pEndUTC = Date.UTC(pEnd.getUTCFullYear(), pEnd.getUTCMonth(), pEnd.getUTCDate());
                            const days = Math.round((pEndUTC - pStartUTC) / (1000 * 60 * 60 * 24)) + 1;
                            period.dailyRate = Math.round((period.allocatedAmount / days) * 1000000) / 1000000;
                            period.daysInPeriod = days;
                        }
                        primePeriodsMap.set(doc.id, period);
                    }
                });
                // Also add newly created prime periods
                newPrimePeriods.forEach(period => {
                    primePeriodsMap.set(period.id, period);
                });
                const allPrimePeriods = Array.from(primePeriodsMap.values());
                // Sort prime periods by start date
                allPrimePeriods.sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());
                console.log(`  📊 Total prime periods available for non-prime calculation: ${allPrimePeriods.length}`);
                // === PHASE 3: Generate new Non-Prime periods ===
                const newNonPrimePeriods = [];
                for (const [nonPrimeType, sourcePeriods] of nonPrimeSourcePeriodsByType) {
                    console.log(`  📝 Processing ${nonPrimeType} non-prime periods (${sourcePeriods.length} source periods)`);
                    for (const sourcePeriod of sourcePeriods) {
                        // Skip if budget period already exists
                        if (existingPeriodIds.has(sourcePeriod.id)) {
                            continue;
                        }
                        // Convert Timestamps to Dates for the helper functions
                        const periodStartDate = sourcePeriod.startDate.toDate();
                        const periodEndDate = sourcePeriod.endDate.toDate();
                        // Find overlapping prime periods
                        const overlappingPrimes = (0, nonPrimePeriodGeneration_1.findOverlappingPrimePeriods)(periodStartDate, periodEndDate, allPrimePeriods);
                        if (overlappingPrimes.length === 0) {
                            console.warn(`  ⚠️ No overlapping prime periods for ${sourcePeriod.id}, skipping`);
                            continue;
                        }
                        // Calculate contributions from prime periods
                        const { totalAmount, breakdown } = (0, nonPrimePeriodGeneration_1.calculatePrimeContributions)(periodStartDate, periodEndDate, overlappingPrimes);
                        // Calculate days in period using UTC-normalized dates to avoid off-by-one errors
                        const npStart = sourcePeriod.startDate.toDate();
                        const npEnd = sourcePeriod.endDate.toDate();
                        const npStartUTC = Date.UTC(npStart.getUTCFullYear(), npStart.getUTCMonth(), npStart.getUTCDate());
                        const npEndUTC = Date.UTC(npEnd.getUTCFullYear(), npEnd.getUTCMonth(), npEnd.getUTCDate());
                        const daysInPeriod = Math.round((npEndUTC - npStartUTC) / (1000 * 60 * 60 * 24)) + 1;
                        const allocatedAmount = Math.round(totalAmount * 100) / 100;
                        const dailyRate = daysInPeriod > 0 ? Math.round((allocatedAmount / daysInPeriod) * 100) / 100 : 0;
                        const budgetPeriod = {
                            id: `${budget.id}_${sourcePeriod.id}`,
                            budgetId: budget.id,
                            periodId: sourcePeriod.id,
                            sourcePeriodId: sourcePeriod.id,
                            familyId: String(budget.familyId || ''),
                            // Ownership - inherit from budget
                            userId: ((_f = budget.access) === null || _f === void 0 ? void 0 : _f.createdBy) || budget.createdBy,
                            createdBy: ((_g = budget.access) === null || _g === void 0 ? void 0 : _g.createdBy) || budget.createdBy,
                            ownerId: ((_h = budget.access) === null || _h === void 0 ? void 0 : _h.ownerId) || budget.ownerId,
                            groupId: budget.groupId,
                            isPrivate: (_k = (_j = budget.access) === null || _j === void 0 ? void 0 : _j.isPrivate) !== null && _k !== void 0 ? _k : budget.isPrivate,
                            accessibleBy: budget.accessibleBy,
                            // Period context
                            periodType: sourcePeriod.type,
                            periodStart: sourcePeriod.startDate,
                            periodEnd: sourcePeriod.endDate,
                            // Budget amounts (derived from prime periods)
                            allocatedAmount,
                            originalAmount: allocatedAmount,
                            // Budget name
                            budgetName: budget.name,
                            // Checklist items
                            checklistItems: [],
                            // User modifications
                            isModified: false,
                            // System fields
                            createdAt: now,
                            updatedAt: now,
                            lastCalculated: now,
                            isActive: true,
                            // === NON-PRIME PERIOD FIELDS ===
                            isPrime: false,
                            dailyRate,
                            daysInPeriod,
                            primePeriodIds: overlappingPrimes.map(p => p.id),
                            primePeriodBreakdown: breakdown,
                        };
                        newNonPrimePeriods.push(budgetPeriod);
                    }
                }
                // Persist non-prime periods
                if (newNonPrimePeriods.length > 0) {
                    console.log(`  🔨 Creating ${newNonPrimePeriods.length} new NON-PRIME budget periods`);
                    await batchCreateBudgetPeriods(db, newNonPrimePeriods);
                }
                const totalNewPeriods = newPrimePeriods.length + newNonPrimePeriods.length;
                if (totalNewPeriods === 0) {
                    console.log(`  ✅ No new periods needed for budget ${budget.id}`);
                }
                else {
                    // Update budget metadata
                    await db.collection('budgets').doc(budget.id).update({
                        lastExtended: now,
                    });
                    console.log(`  ✅ Extended budget ${budget.id} with ${totalNewPeriods} new periods (${newPrimePeriods.length} prime, ${newNonPrimePeriods.length} non-prime)`);
                }
                totalPeriodsCreated += totalNewPeriods;
                budgetsProcessed++;
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
        console.log(`  📦 Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
    }
}
//# sourceMappingURL=extendRecurringBudgetPeriods.js.map