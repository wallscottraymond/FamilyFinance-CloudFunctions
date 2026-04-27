"use strict";
/**
 * Scheduled Inflow Period Maintenance
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of inflow periods for recurring income sources.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC (matches budget maintenance)
 * - Maintains 1-year rolling window for recurring inflows
 * - Creates inflow_periods for any missing source_periods
 * - Uses occurrence calculation for multi-payment tracking
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
exports.extendRecurringInflowPeriods = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const calculateAllOccurrencesInPeriod_1 = require("../../inflow_periods/utils/calculateAllOccurrencesInPeriod");
/**
 * Scheduled function to extend recurring inflow periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
exports.extendRecurringInflowPeriods = (0, scheduler_1.onSchedule)({
    schedule: '0 2 1 * *', // Cron: minute hour day month dayOfWeek
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
}, async (event) => {
    console.log('[extendRecurringInflowPeriods] Starting scheduled inflow period extension...');
    const db = admin.firestore();
    const now = firestore_1.Timestamp.now();
    try {
        // Get all active inflows
        const activeInflowsQuery = db.collection('inflows')
            .where('isActive', '==', true);
        const activeInflowsSnapshot = await activeInflowsQuery.get();
        if (activeInflowsSnapshot.empty) {
            console.log('[extendRecurringInflowPeriods] No active inflows found to maintain');
            return;
        }
        console.log(`[extendRecurringInflowPeriods] Found ${activeInflowsSnapshot.size} active inflows to maintain`);
        let totalPeriodsCreated = 0;
        let inflowsProcessed = 0;
        // Simple rolling window: always maintain 1 year from today
        const today = new Date();
        const oneYearFromToday = new Date(today);
        oneYearFromToday.setMonth(oneYearFromToday.getMonth() + 12);
        console.log(`[extendRecurringInflowPeriods] Maintaining 1-year window: ${today.toISOString()} to ${oneYearFromToday.toISOString()}`);
        // Get all source periods for the rolling window
        const sourcePeriodsQuery = db.collection('source_periods')
            .where('startDate', '>=', firestore_1.Timestamp.fromDate(today))
            .where('startDate', '<=', firestore_1.Timestamp.fromDate(oneYearFromToday));
        const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
        if (sourcePeriodsSnapshot.empty) {
            console.warn('[extendRecurringInflowPeriods] No source periods found in rolling window - may need source period generation');
            return;
        }
        console.log(`[extendRecurringInflowPeriods] Found ${sourcePeriodsSnapshot.size} source periods in rolling window`);
        const allSourcePeriods = sourcePeriodsSnapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
        // Process each active inflow
        for (const inflowDoc of activeInflowsSnapshot.docs) {
            const inflow = Object.assign({ id: inflowDoc.id }, inflowDoc.data());
            try {
                console.log(`[extendRecurringInflowPeriods] Processing inflow: ${inflow.description || inflow.merchantName || inflow.id}`);
                // Get existing inflow periods for this inflow
                const existingPeriodsQuery = db.collection('inflow_periods')
                    .where('inflowId', '==', inflow.id);
                const existingPeriodsSnapshot = await existingPeriodsQuery.get();
                const existingPeriodIds = new Set(existingPeriodsSnapshot.docs.map(doc => doc.data().sourcePeriodId));
                // Calculate payment cycle info
                const cycleInfo = calculatePaymentCycle(inflow);
                // Find missing source periods and create inflow periods
                const newInflowPeriods = [];
                for (const sourcePeriod of allSourcePeriods) {
                    // Skip if inflow period already exists for this source period
                    if (existingPeriodIds.has(sourcePeriod.id)) {
                        continue;
                    }
                    // Extract ownership fields
                    const userId = inflow.ownerId || inflow.userId;
                    const groupId = inflow.groupId || null;
                    // Calculate period amounts
                    const periodCalc = calculatePeriodAmounts(sourcePeriod, cycleInfo, inflow);
                    // Calculate multi-occurrence tracking
                    const occurrences = (0, calculateAllOccurrencesInPeriod_1.calculateAllOccurrencesInPeriod)(inflow, sourcePeriod);
                    // Calculate financial totals based on occurrences
                    const amountPerOccurrence = cycleInfo.incomeAmount;
                    const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;
                    // Initialize occurrence tracking arrays
                    const occurrencePaidFlags = new Array(occurrences.numberOfOccurrences).fill(false);
                    const occurrenceTransactionIds = new Array(occurrences.numberOfOccurrences).fill(null);
                    // Determine first and last expected dates
                    const firstDueDateInPeriod = occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null;
                    const lastDueDateInPeriod = occurrences.numberOfOccurrences > 0
                        ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1]
                        : null;
                    // Build inflow period document
                    const inflowPeriodDoc = {
                        // === IDENTITY ===
                        id: `${inflow.id}_${sourcePeriod.id}`,
                        inflowId: inflow.id,
                        sourcePeriodId: sourcePeriod.id,
                        // === OWNERSHIP & ACCESS ===
                        ownerId: userId,
                        createdBy: inflow.createdBy || userId,
                        updatedBy: userId,
                        groupId: groupId,
                        // === PLAID IDENTIFIERS ===
                        accountId: inflow.accountId,
                        plaidItemId: inflow.plaidItemId,
                        // === FINANCIAL TRACKING ===
                        actualAmount: null,
                        amountWithheld: periodCalc.amountEarned,
                        averageAmount: cycleInfo.incomeAmount,
                        expectedAmount: totalAmountDue,
                        amountPerOccurrence: amountPerOccurrence,
                        amountAllocated: occurrences.amountAllocated,
                        totalAmountDue: totalAmountDue,
                        totalAmountPaid: 0,
                        totalAmountUnpaid: totalAmountDue,
                        // === TIMESTAMPS ===
                        createdAt: now,
                        updatedAt: now,
                        lastCalculated: now,
                        // === PAYMENT CYCLE INFO ===
                        currency: inflow.currency || 'USD',
                        cycleDays: cycleInfo.cycleDays,
                        cycleStartDate: cycleInfo.cycleStartDate,
                        cycleEndDate: cycleInfo.cycleEndDate,
                        dailyWithholdingRate: periodCalc.amountEarned / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate),
                        // === INFLOW METADATA (Denormalized) ===
                        description: inflow.description || null,
                        frequency: inflow.frequency,
                        // === PAYMENT STATUS ===
                        isPaid: false,
                        isFullyPaid: false,
                        isPartiallyPaid: false,
                        isReceiptPeriod: occurrences.numberOfOccurrences > 0,
                        // === CATEGORIZATION ===
                        internalDetailedCategory: inflow.internalDetailedCategory || null,
                        internalPrimaryCategory: inflow.internalPrimaryCategory || null,
                        plaidPrimaryCategory: inflow.plaidPrimaryCategory || 'INCOME',
                        plaidDetailedCategory: inflow.plaidDetailedCategory || '',
                        // === STATUS & CONTROL ===
                        isActive: true,
                        isHidden: false,
                        // === MERCHANT INFO ===
                        merchant: inflow.merchantName,
                        payee: inflow.merchantName,
                        // === PERIOD CONTEXT ===
                        periodStartDate: sourcePeriod.startDate,
                        periodEndDate: sourcePeriod.endDate,
                        periodType: sourcePeriod.type,
                        // === PREDICTION ===
                        predictedNextDate: occurrences.nextExpectedDate,
                        // === USER INTERACTION ===
                        rules: [],
                        tags: inflow.tags || [],
                        type: inflow.type || 'income',
                        note: null,
                        userCustomName: inflow.userCustomName || null,
                        // === SOURCE ===
                        source: inflow.source || 'plaid',
                        // === TRANSACTION TRACKING ===
                        transactionIds: [],
                        // === MULTI-OCCURRENCE TRACKING ===
                        numberOfOccurrencesInPeriod: occurrences.numberOfOccurrences,
                        numberOfOccurrencesPaid: 0,
                        numberOfOccurrencesUnpaid: occurrences.numberOfOccurrences,
                        occurrenceDueDates: occurrences.occurrenceDueDates,
                        occurrencePaidFlags: occurrencePaidFlags,
                        occurrenceTransactionIds: occurrenceTransactionIds,
                        // === PROGRESS METRICS ===
                        paymentProgressPercentage: 0,
                        dollarProgressPercentage: 0,
                        // === DUE DATE TRACKING ===
                        firstDueDateInPeriod: firstDueDateInPeriod,
                        lastDueDateInPeriod: lastDueDateInPeriod,
                        nextUnpaidDueDate: firstDueDateInPeriod
                    };
                    newInflowPeriods.push(inflowPeriodDoc);
                }
                // Persist new inflow periods
                if (newInflowPeriods.length > 0) {
                    console.log(`[extendRecurringInflowPeriods] Creating ${newInflowPeriods.length} new inflow periods for ${inflow.id}`);
                    await batchCreateInflowPeriods(db, newInflowPeriods);
                    // Update inflow metadata
                    await db.collection('inflows').doc(inflow.id).update({
                        lastExtended: now,
                    });
                    totalPeriodsCreated += newInflowPeriods.length;
                }
                else {
                    console.log(`[extendRecurringInflowPeriods] No new periods needed for inflow ${inflow.id}`);
                }
                inflowsProcessed++;
            }
            catch (error) {
                console.error(`[extendRecurringInflowPeriods] Error processing inflow ${inflow.id}:`, error);
                // Continue processing other inflows
            }
        }
        // Log final summary
        console.log(`[extendRecurringInflowPeriods] Maintenance complete:`);
        console.log(`   - Inflows processed: ${inflowsProcessed}`);
        console.log(`   - Total periods created: ${totalPeriodsCreated}`);
    }
    catch (error) {
        console.error('[extendRecurringInflowPeriods] Fatal error in scheduled inflow period extension:', error);
        throw error; // Re-throw to mark the function execution as failed
    }
});
/**
 * Calculate payment cycle information from inflow data
 */
function calculatePaymentCycle(inflow) {
    var _a;
    const incomeAmount = Math.abs(typeof inflow.averageAmount === 'number'
        ? inflow.averageAmount
        : ((_a = inflow.averageAmount) === null || _a === void 0 ? void 0 : _a.amount) || 0);
    let cycleDays;
    switch (inflow.frequency) {
        case types_1.PlaidRecurringFrequency.WEEKLY:
            cycleDays = 7;
            break;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
            cycleDays = 14;
            break;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
            cycleDays = 15;
            break;
        case types_1.PlaidRecurringFrequency.MONTHLY:
            cycleDays = 30;
            break;
        case types_1.PlaidRecurringFrequency.ANNUALLY:
            cycleDays = 365;
            break;
        default:
            cycleDays = 30;
    }
    const dailyRate = incomeAmount / cycleDays;
    const cycleEndDate = inflow.lastDate;
    const cycleStartDate = firestore_1.Timestamp.fromDate(new Date(cycleEndDate.toDate().getTime() - (cycleDays * 24 * 60 * 60 * 1000)));
    return { incomeAmount, cycleDays, dailyRate, cycleStartDate, cycleEndDate };
}
/**
 * Calculate earning amounts for a specific period
 */
function calculatePeriodAmounts(sourcePeriod, cycleInfo, inflow) {
    const periodStart = sourcePeriod.startDate.toDate();
    const periodEnd = sourcePeriod.endDate.toDate();
    const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const amountEarned = cycleInfo.dailyRate * daysInPeriod;
    return {
        amountEarned: Math.round(amountEarned * 100) / 100,
    };
}
/**
 * Helper function to calculate days in a period
 */
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
/**
 * Efficiently create multiple inflow_periods using Firestore batch operations
 */
async function batchCreateInflowPeriods(db, inflowPeriods) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < inflowPeriods.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchPeriods = inflowPeriods.slice(i, i + BATCH_SIZE);
        batchPeriods.forEach((inflowPeriod) => {
            const docRef = db.collection('inflow_periods').doc(inflowPeriod.id);
            batch.set(docRef, inflowPeriod);
        });
        await batch.commit();
        console.log(`[extendRecurringInflowPeriods] Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inflowPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
    }
}
//# sourceMappingURL=extendRecurringInflowPeriods.js.map