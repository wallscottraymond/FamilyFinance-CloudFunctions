"use strict";
/**
 * Regenerate Inflow Periods Callable
 *
 * Admin/dev function to regenerate inflow_periods for an existing inflow.
 * Useful for fixing data when periods weren't created correctly.
 *
 * Usage:
 * - Call with inflowId to regenerate periods for that specific inflow
 * - Call without inflowId to regenerate for all user's inflows
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
exports.regenerateInflowPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const calculateAllOccurrencesInPeriod_1 = require("../utils/calculateAllOccurrencesInPeriod");
exports.regenerateInflowPeriods = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (request) => {
    // Verify authentication
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userId = request.auth.uid;
    const { inflowId } = request.data;
    const db = admin.firestore();
    const result = {
        inflowsProcessed: 0,
        periodsCreated: 0,
        periodsUpdated: 0,
        errors: []
    };
    console.log(`[regenerateInflowPeriods] Starting for user: ${userId}, inflowId: ${inflowId || 'ALL'}`);
    try {
        // Get inflows to process
        let inflowsQuery = db.collection('inflows')
            .where('ownerId', '==', userId)
            .where('isActive', '==', true);
        if (inflowId) {
            // Fetch specific inflow
            const inflowDoc = await db.collection('inflows').doc(inflowId).get();
            if (!inflowDoc.exists) {
                throw new https_1.HttpsError('not-found', `Inflow ${inflowId} not found`);
            }
            const inflowData = inflowDoc.data();
            if ((inflowData === null || inflowData === void 0 ? void 0 : inflowData.ownerId) !== userId) {
                throw new https_1.HttpsError('permission-denied', 'You can only regenerate your own inflows');
            }
            await processInflow(db, inflowDoc.id, inflowData, result);
        }
        else {
            // Process all user's inflows
            const inflowsSnapshot = await inflowsQuery.get();
            console.log(`[regenerateInflowPeriods] Found ${inflowsSnapshot.size} inflows to process`);
            for (const inflowDoc of inflowsSnapshot.docs) {
                await processInflow(db, inflowDoc.id, inflowDoc.data(), result);
            }
        }
        console.log(`[regenerateInflowPeriods] Complete:`, result);
        return result;
    }
    catch (error) {
        console.error('[regenerateInflowPeriods] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to regenerate inflow periods');
    }
});
async function processInflow(db, inflowId, inflowData, result) {
    var _a, _b;
    try {
        result.inflowsProcessed++;
        console.log(`[regenerateInflowPeriods] Processing inflow: ${inflowId}`);
        const userId = inflowData.ownerId;
        const groupId = inflowData.groupId || null;
        const now = firestore_1.Timestamp.now();
        // Calculate time range: from inflow's firstDate to 12 months forward
        // This ensures we generate periods for the entire history of the inflow (matches budget periods)
        const startDate = ((_a = inflowData.firstDate) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 12); // 12 months forward (matches budgets)
        console.log(`[regenerateInflowPeriods] Date range: ${startDate.toISOString()} (inflow firstDate) to ${endDate.toISOString()} (12 months forward)`);
        // Get source periods in range
        const sourcePeriodsQuery = db.collection('source_periods')
            .where('startDate', '>=', firestore_1.Timestamp.fromDate(startDate))
            .where('startDate', '<=', firestore_1.Timestamp.fromDate(endDate));
        const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
        if (sourcePeriodsSnapshot.empty) {
            console.log(`[regenerateInflowPeriods] No source periods found for inflow ${inflowId}`);
            return;
        }
        console.log(`[regenerateInflowPeriods] Found ${sourcePeriodsSnapshot.size} source periods`);
        // Calculate payment cycle info
        const cycleInfo = calculatePaymentCycle(inflowData);
        // Process each source period
        const batch = db.batch();
        let batchCount = 0;
        for (const sourcePeriodDoc of sourcePeriodsSnapshot.docs) {
            const sourcePeriod = Object.assign({ id: sourcePeriodDoc.id }, sourcePeriodDoc.data());
            const periodId = `${inflowId}_${sourcePeriod.id}`;
            // Check if period already exists
            const existingPeriodDoc = await db.collection('inflow_periods').doc(periodId).get();
            // Calculate period amounts
            const periodCalc = calculatePeriodAmounts(sourcePeriod, cycleInfo, inflowData);
            // Use proper utility that checks actual income dates against period boundaries
            const occurrences = (0, calculateAllOccurrencesInPeriod_1.calculateAllOccurrencesInPeriod)(inflowData, sourcePeriod);
            const amountPerOccurrence = cycleInfo.incomeAmount;
            const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;
            // Build inflow period document
            const inflowPeriodDoc = {
                id: periodId,
                inflowId: inflowId,
                sourcePeriodId: sourcePeriod.id,
                ownerId: userId,
                createdBy: inflowData.createdBy || userId,
                updatedBy: userId,
                groupId: groupId,
                accountId: inflowData.accountId,
                plaidItemId: inflowData.plaidItemId,
                actualAmount: null,
                amountWithheld: periodCalc.amountEarned,
                averageAmount: cycleInfo.incomeAmount,
                expectedAmount: totalAmountDue,
                amountPerOccurrence: amountPerOccurrence,
                totalAmountDue: totalAmountDue,
                totalAmountPaid: 0,
                totalAmountUnpaid: totalAmountDue,
                createdAt: existingPeriodDoc.exists ? (_b = existingPeriodDoc.data()) === null || _b === void 0 ? void 0 : _b.createdAt : now,
                updatedAt: now,
                lastCalculated: now,
                currency: inflowData.currency || 'USD',
                cycleDays: cycleInfo.cycleDays,
                cycleStartDate: cycleInfo.cycleStartDate,
                cycleEndDate: cycleInfo.cycleEndDate,
                dailyWithholdingRate: periodCalc.amountEarned / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate),
                description: inflowData.description,
                frequency: inflowData.frequency,
                isPaid: false,
                isFullyPaid: false,
                isPartiallyPaid: false,
                isReceiptPeriod: occurrences.numberOfOccurrences > 0,
                internalDetailedCategory: inflowData.internalDetailedCategory || null,
                internalPrimaryCategory: inflowData.internalPrimaryCategory || null,
                plaidPrimaryCategory: inflowData.plaidPrimaryCategory || 'INCOME',
                plaidDetailedCategory: inflowData.plaidDetailedCategory || '',
                isActive: true,
                isHidden: false,
                merchant: inflowData.merchantName,
                payee: inflowData.merchantName,
                periodStartDate: sourcePeriod.startDate,
                periodEndDate: sourcePeriod.endDate,
                periodType: sourcePeriod.type,
                predictedNextDate: inflowData.predictedNextDate || null,
                rules: [],
                tags: inflowData.tags || [],
                type: inflowData.type || 'income',
                note: null,
                userCustomName: inflowData.userCustomName || null,
                source: inflowData.source || 'plaid',
                transactionIds: [],
                numberOfOccurrencesInPeriod: occurrences.numberOfOccurrences,
                numberOfOccurrencesPaid: 0,
                numberOfOccurrencesUnpaid: occurrences.numberOfOccurrences,
                occurrenceDueDates: occurrences.occurrenceDueDates,
                occurrencePaidFlags: new Array(occurrences.numberOfOccurrences).fill(false),
                occurrenceTransactionIds: new Array(occurrences.numberOfOccurrences).fill(null),
                paymentProgressPercentage: 0,
                dollarProgressPercentage: 0,
                firstDueDateInPeriod: occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null,
                lastDueDateInPeriod: occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1] : null,
                nextUnpaidDueDate: occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null
            };
            const docRef = db.collection('inflow_periods').doc(periodId);
            if (existingPeriodDoc.exists) {
                batch.update(docRef, inflowPeriodDoc);
                result.periodsUpdated++;
            }
            else {
                batch.set(docRef, inflowPeriodDoc);
                result.periodsCreated++;
            }
            batchCount++;
            // Commit batch every 500 operations
            if (batchCount >= 500) {
                await batch.commit();
                batchCount = 0;
            }
        }
        // Commit remaining operations
        if (batchCount > 0) {
            await batch.commit();
        }
        console.log(`[regenerateInflowPeriods] Processed inflow ${inflowId}: created ${result.periodsCreated}, updated ${result.periodsUpdated}`);
    }
    catch (error) {
        console.error(`[regenerateInflowPeriods] Error processing inflow ${inflowId}:`, error);
        result.errors.push(`Inflow ${inflowId}: ${error.message}`);
    }
}
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
function calculatePeriodAmounts(sourcePeriod, cycleInfo, inflow) {
    const periodStart = sourcePeriod.startDate.toDate();
    const periodEnd = sourcePeriod.endDate.toDate();
    const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const amountEarned = cycleInfo.dailyRate * daysInPeriod;
    return {
        amountEarned: Math.round(amountEarned * 100) / 100,
    };
}
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
//# sourceMappingURL=regenerateInflowPeriods.js.map