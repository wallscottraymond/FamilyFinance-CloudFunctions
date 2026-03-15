"use strict";
/**
 * Admin HTTP Endpoint: Regenerate Inflow Periods
 *
 * Temporary admin function to regenerate inflow periods for data repair.
 * This is an HTTP function (not callable) that can be invoked directly.
 *
 * Security: Protected by a simple admin key in the request header.
 *
 * Usage:
 *   curl -X POST \
 *     -H "x-admin-key: family-finance-admin-2025" \
 *     https://us-central1-family-budget-app-cb59b.cloudfunctions.net/adminRegenerateInflowPeriods
 *
 * Or for a specific user:
 *   curl -X POST \
 *     -H "x-admin-key: family-finance-admin-2025" \
 *     -H "Content-Type: application/json" \
 *     -d '{"userId": "USER_ID_HERE"}' \
 *     https://us-central1-family-budget-app-cb59b.cloudfunctions.net/adminRegenerateInflowPeriods
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
exports.adminRegenerateInflowPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const calculateAllOccurrencesInPeriod_1 = require("../utils/calculateAllOccurrencesInPeriod");
// Simple admin key for this one-time task
const ADMIN_KEY = 'family-finance-admin-2025';
exports.adminRegenerateInflowPeriods = (0, https_1.onRequest)({
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540, // 9 minutes max
    cors: false,
}, async (request, response) => {
    var _a, _b, _c;
    // Verify admin key
    const adminKey = request.headers['x-admin-key'];
    if (adminKey !== ADMIN_KEY) {
        response.status(403).json({ error: 'Unauthorized' });
        return;
    }
    const db = admin.firestore();
    const result = {
        usersProcessed: 0,
        inflowsProcessed: 0,
        periodsCreated: 0,
        periodsUpdated: 0,
        errors: []
    };
    // Get userId from request body if provided
    let targetUserId = null;
    if (request.body && request.body.userId) {
        targetUserId = request.body.userId;
    }
    console.log(`[adminRegenerateInflowPeriods] Starting. Target user: ${targetUserId || 'ALL'}`);
    try {
        // Get all active inflows
        let inflowsQuery;
        if (targetUserId) {
            inflowsQuery = db.collection('inflows')
                .where('ownerId', '==', targetUserId)
                .where('isActive', '==', true);
        }
        else {
            inflowsQuery = db.collection('inflows')
                .where('isActive', '==', true);
        }
        const inflowsSnapshot = await inflowsQuery.get();
        console.log(`[adminRegenerateInflowPeriods] Found ${inflowsSnapshot.size} active inflows`);
        const processedUsers = new Set();
        for (const inflowDoc of inflowsSnapshot.docs) {
            const inflowData = inflowDoc.data();
            const inflowId = inflowDoc.id;
            const userId = inflowData.ownerId;
            processedUsers.add(userId);
            result.inflowsProcessed++;
            console.log(`\n[adminRegenerateInflowPeriods] Processing inflow: ${inflowId}`);
            console.log(`  Description: ${inflowData.description || inflowData.payerName || 'Unknown'}`);
            console.log(`  Frequency: ${inflowData.frequency}`);
            console.log(`  First Date: ${(_a = inflowData.firstDate) === null || _a === void 0 ? void 0 : _a.toDate().toISOString()}`);
            console.log(`  Last Date: ${(_b = inflowData.lastDate) === null || _b === void 0 ? void 0 : _b.toDate().toISOString()}`);
            console.log(`  Predicted Next: ${((_c = inflowData.predictedNextDate) === null || _c === void 0 ? void 0 : _c.toDate().toISOString()) || 'N/A'}`);
            try {
                await processInflow(db, inflowId, inflowData, result);
            }
            catch (error) {
                console.error(`[adminRegenerateInflowPeriods] Error processing inflow ${inflowId}:`, error);
                result.errors.push(`Inflow ${inflowId}: ${error.message}`);
            }
        }
        result.usersProcessed = processedUsers.size;
        console.log(`\n[adminRegenerateInflowPeriods] Complete:`, result);
        response.status(200).json({
            success: true,
            result
        });
    }
    catch (error) {
        console.error('[adminRegenerateInflowPeriods] Error:', error);
        response.status(500).json({
            success: false,
            error: error.message,
            result
        });
    }
});
async function processInflow(db, inflowId, inflowData, result) {
    var _a, _b;
    const userId = inflowData.ownerId;
    const groupId = inflowData.groupId || null;
    const now = firestore_1.Timestamp.now();
    // Calculate time range: from inflow's firstDate to 3 months forward
    const startDate = ((_a = inflowData.firstDate) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);
    console.log(`  Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    // Get source periods in range
    const sourcePeriodsQuery = db.collection('source_periods')
        .where('startDate', '>=', firestore_1.Timestamp.fromDate(startDate))
        .where('startDate', '<=', firestore_1.Timestamp.fromDate(endDate));
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    if (sourcePeriodsSnapshot.empty) {
        console.log(`  No source periods found in range`);
        return;
    }
    console.log(`  Found ${sourcePeriodsSnapshot.size} source periods`);
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
        // Use proper utility that checks actual income dates against period boundaries
        const occurrences = (0, calculateAllOccurrencesInPeriod_1.calculateAllOccurrencesInPeriod)(inflowData, sourcePeriod);
        const amountPerOccurrence = cycleInfo.incomeAmount;
        const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;
        const periodDays = getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate);
        const amountEarned = cycleInfo.dailyRate * periodDays;
        // Log occurrence details for verification
        if (occurrences.numberOfOccurrences > 0) {
            const dueDates = occurrences.occurrenceDueDates.map((d) => d.toDate().toISOString().split('T')[0]);
            console.log(`    Period ${sourcePeriod.id}: ${occurrences.numberOfOccurrences} occurrence(s) on ${dueDates.join(', ')}`);
        }
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
            amountWithheld: Math.round(amountEarned * 100) / 100,
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
            dailyWithholdingRate: amountEarned / periodDays,
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
        // Commit batch every 400 operations
        if (batchCount >= 400) {
            await batch.commit();
            batchCount = 0;
        }
    }
    // Commit remaining operations
    if (batchCount > 0) {
        await batch.commit();
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
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
//# sourceMappingURL=adminRegenerateInflowPeriods.js.map