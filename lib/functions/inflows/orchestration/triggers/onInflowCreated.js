"use strict";
/**
 * Inflow Periods Auto-Generation - UPDATED FOR FLAT STRUCTURE
 *
 * This Cloud Function automatically creates inflow_periods when an inflow is created.
 * It generates periods for all period types by integrating with the source_periods collection
 * and calculating cycle-based earning amounts for each period.
 *
 * UPDATED: Now supports BOTH flat and nested inflow structures for backward compatibility.
 * - Flat structure (new): All fields at root level (ownerId, plaidPrimaryCategory, etc.)
 * - Nested structure (old): Fields in nested objects (access, categories, metadata)
 *
 * Key Features:
 * - Integration with existing source_periods collection
 * - Cycle-based earning calculation (daily rate × period days)
 * - Payment receipt date tracking and period alignment
 * - Support for all Plaid recurring frequencies (WEEKLY, MONTHLY, QUARTERLY, ANNUALLY)
 * - Proper error handling for missing source periods
 * - Edge case handling for different month lengths and leap years
 * - Backward compatibility with both flat and nested inflow structures
 *
 * Memory: 512MiB, Timeout: 60s
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
exports.onInflowCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const firestore_2 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
/**
 * Triggered when an inflow is created
 * Automatically generates inflow_periods for all active source periods
 * Supports BOTH flat and nested inflow structures
 */
exports.onInflowCreated = (0, firestore_1.onDocumentCreated)({
    document: 'inflows/{inflowId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const inflowId = event.params.inflowId;
        const inflowData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data(); // Accept both flat and nested structures
        if (!inflowData) {
            console.error('No inflow data found');
            return;
        }
        // Detect if this is flat or nested structure
        const isFlat = 'ownerId' in inflowData;
        console.log(`Inflow structure: ${isFlat ? 'FLAT (new)' : 'NESTED (legacy)'}`);
        // Extract fields based on structure type
        const userId = isFlat ? inflowData.ownerId : inflowData.userId;
        const groupId = inflowData.groupId || null;
        const description = inflowData.description || null;
        const merchantName = inflowData.merchantName || null;
        // Skip inactive inflows
        if (!inflowData.isActive) {
            console.log(`Skipping inactive inflow: ${inflowId}`);
            return;
        }
        console.log(`Creating inflow periods for inflow: ${inflowId}`);
        console.log(`Inflow details: ${description}, Amount: ${inflowData.averageAmount || ((_b = inflowData.averageAmount) === null || _b === void 0 ? void 0 : _b.amount)}, Frequency: ${inflowData.frequency}`);
        const db = admin.firestore();
        const now = firestore_2.Timestamp.now();
        // Calculate time range for period generation (3 months forward like budget periods)
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 3); // 3 months forward
        console.log(`Generating inflow periods from ${startDate.toISOString()} to ${endDate.toISOString()}`);
        // Get all source periods that overlap with our time range
        const sourcePeriodsQuery = db.collection('source_periods')
            .where('startDate', '>=', firestore_2.Timestamp.fromDate(startDate))
            .where('startDate', '<=', firestore_2.Timestamp.fromDate(endDate));
        const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
        if (sourcePeriodsSnapshot.empty) {
            console.warn('No source periods found in date range - inflow periods cannot be generated');
            return;
        }
        console.log(`Found ${sourcePeriodsSnapshot.size} source periods to process`);
        // Calculate payment cycle information
        const cycleInfo = calculatePaymentCycle(inflowData);
        console.log(`Payment cycle: ${cycleInfo.cycleDays} days, Rate: ${cycleInfo.dailyRate}`);
        // Create inflow_periods for each source period
        const inflowPeriods = [];
        for (const doc of sourcePeriodsSnapshot.docs) {
            const sourcePeriod = Object.assign({ id: doc.id }, doc.data());
            // Calculate earning amounts for this period
            const periodCalc = calculatePeriodAmounts(sourcePeriod, cycleInfo, inflowData);
            // Calculate multi-occurrence tracking (similar to outflows)
            const occurrences = calculateAllOccurrencesInPeriod(inflowData, sourcePeriod, cycleInfo);
            // Calculate financial totals based on occurrences
            const amountPerOccurrence = cycleInfo.incomeAmount;
            const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;
            const totalAmountPaid = 0; // At creation, nothing received yet
            const totalAmountUnpaid = totalAmountDue;
            // Initialize occurrence tracking arrays (all unreceived at creation)
            const occurrencePaidFlags = new Array(occurrences.numberOfOccurrences).fill(false);
            const occurrenceTransactionIds = new Array(occurrences.numberOfOccurrences).fill(null);
            // Calculate progress metrics
            const paymentProgressPercentage = 0; // No receipts yet
            const dollarProgressPercentage = 0; // No receipts yet
            // Determine payment status
            const isFullyPaid = false;
            const isPartiallyPaid = false;
            // Determine first and last expected dates
            const firstDueDateInPeriod = occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null;
            const lastDueDateInPeriod = occurrences.numberOfOccurrences > 0
                ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1]
                : null;
            const nextUnpaidDueDate = firstDueDateInPeriod;
            // Build FLAT inflow period structure
            const inflowPeriodDoc = {
                // === IDENTITY ===
                id: `${inflowId}_${sourcePeriod.id}`,
                inflowId: inflowId,
                sourcePeriodId: sourcePeriod.id,
                // === OWNERSHIP & ACCESS (Query-Critical) ===
                ownerId: userId,
                createdBy: isFlat ? inflowData.createdBy : (((_c = inflowData.metadata) === null || _c === void 0 ? void 0 : _c.createdBy) || userId),
                updatedBy: isFlat ? inflowData.createdBy : (((_d = inflowData.metadata) === null || _d === void 0 ? void 0 : _d.createdBy) || userId),
                groupId: groupId,
                // === PLAID IDENTIFIERS ===
                accountId: inflowData.accountId,
                plaidItemId: inflowData.plaidItemId,
                // === FINANCIAL TRACKING ===
                actualAmount: null, // Null until transaction attached
                amountWithheld: periodCalc.amountEarned,
                averageAmount: cycleInfo.incomeAmount,
                expectedAmount: totalAmountDue,
                amountPerOccurrence: amountPerOccurrence,
                totalAmountDue: totalAmountDue,
                totalAmountPaid: totalAmountPaid,
                totalAmountUnpaid: totalAmountUnpaid,
                // === TIMESTAMPS ===
                createdAt: now,
                updatedAt: now,
                lastCalculated: now,
                // === PAYMENT CYCLE INFO ===
                currency: inflowData.currency || 'USD',
                cycleDays: cycleInfo.cycleDays,
                cycleStartDate: cycleInfo.cycleStartDate,
                cycleEndDate: cycleInfo.cycleEndDate,
                dailyWithholdingRate: periodCalc.amountEarned / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate),
                // === INFLOW METADATA (Denormalized) ===
                description: description,
                frequency: inflowData.frequency,
                // === PAYMENT STATUS ===
                isPaid: isFullyPaid,
                isFullyPaid: isFullyPaid,
                isPartiallyPaid: isPartiallyPaid,
                isReceiptPeriod: occurrences.numberOfOccurrences > 0,
                // === CATEGORIZATION ===
                internalDetailedCategory: isFlat ? inflowData.internalDetailedCategory : (((_e = inflowData.categories) === null || _e === void 0 ? void 0 : _e.detailed) || null),
                internalPrimaryCategory: isFlat ? inflowData.internalPrimaryCategory : (((_f = inflowData.categories) === null || _f === void 0 ? void 0 : _f.primary) || null),
                plaidPrimaryCategory: isFlat ? inflowData.plaidPrimaryCategory : (((_g = inflowData.categories) === null || _g === void 0 ? void 0 : _g.primary) || 'INCOME'),
                plaidDetailedCategory: isFlat ? inflowData.plaidDetailedCategory : (((_h = inflowData.categories) === null || _h === void 0 ? void 0 : _h.detailed) || ''),
                // === STATUS & CONTROL ===
                isActive: true,
                isHidden: false,
                // === MERCHANT INFO ===
                merchant: merchantName,
                payee: merchantName,
                // === PERIOD CONTEXT ===
                periodStartDate: sourcePeriod.startDate,
                periodEndDate: sourcePeriod.endDate,
                periodType: sourcePeriod.type,
                // === PLAID PREDICTION ===
                predictedNextDate: inflowData.predictedNextDate || null,
                // === USER INTERACTION ===
                rules: [],
                tags: inflowData.tags || [],
                type: inflowData.type || 'income',
                note: null,
                userCustomName: null,
                // === SOURCE ===
                source: inflowData.source || 'plaid',
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
                paymentProgressPercentage: paymentProgressPercentage,
                dollarProgressPercentage: dollarProgressPercentage,
                // === DUE DATE TRACKING ===
                firstDueDateInPeriod: firstDueDateInPeriod,
                lastDueDateInPeriod: lastDueDateInPeriod,
                nextUnpaidDueDate: nextUnpaidDueDate
            };
            inflowPeriods.push(inflowPeriodDoc);
        }
        console.log('Document created:', {
            userId,
            groupId
        });
        console.log(`Creating ${inflowPeriods.length} inflow periods`);
        // Batch create all inflow_periods
        await batchCreateInflowPeriods(db, inflowPeriods);
        console.log(`Successfully created ${inflowPeriods.length} inflow periods for inflow ${inflowId}`);
    }
    catch (error) {
        console.error('Error in onInflowCreated:', error);
        // Don't throw - we don't want to break inflow creation if period generation fails
    }
});
/**
 * Calculate payment cycle information from inflow data
 * Supports both flat and nested structures
 */
function calculatePaymentCycle(inflow) {
    // Handle both flat (averageAmount: number) and nested (averageAmount: {amount: number})
    const incomeAmount = Math.abs(typeof inflow.averageAmount === 'number'
        ? inflow.averageAmount
        : inflow.averageAmount.amount); // Ensure positive
    // Calculate cycle days based on frequency
    let cycleDays;
    switch (inflow.frequency) {
        case types_1.PlaidRecurringFrequency.WEEKLY:
            cycleDays = 7;
            break;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
            cycleDays = 14;
            break;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
            cycleDays = 15; // Approximate - twice per month
            break;
        case types_1.PlaidRecurringFrequency.MONTHLY:
            cycleDays = 30; // Use 30 as average month length
            break;
        case types_1.PlaidRecurringFrequency.ANNUALLY:
            cycleDays = 365;
            break;
        default:
            console.warn(`Unknown frequency: ${inflow.frequency}, defaulting to 30 days`);
            cycleDays = 30;
    }
    // Calculate daily earning rate
    const dailyRate = incomeAmount / cycleDays;
    // Use the inflow's lastDate as cycle end, calculate cycle start
    const cycleEndDate = inflow.lastDate;
    const cycleStartDate = firestore_2.Timestamp.fromDate(new Date(cycleEndDate.toDate().getTime() - (cycleDays * 24 * 60 * 60 * 1000)));
    return {
        incomeAmount,
        cycleDays,
        dailyRate,
        cycleStartDate,
        cycleEndDate
    };
}
/**
 * Calculate earning and receipt amounts for a specific period
 * Supports both flat and nested structures
 */
function calculatePeriodAmounts(sourcePeriod, cycleInfo, inflow) {
    const periodStart = sourcePeriod.startDate.toDate();
    const periodEnd = sourcePeriod.endDate.toDate();
    const cycleEnd = cycleInfo.cycleEndDate.toDate();
    // Calculate days in this period
    const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    // Calculate amount earned for this period
    const amountEarned = cycleInfo.dailyRate * daysInPeriod;
    // Check if receipt date falls within this period
    const isReceiptPeriod = cycleEnd >= periodStart && cycleEnd <= periodEnd;
    const amountReceived = isReceiptPeriod ? cycleInfo.incomeAmount : 0;
    const receiptDate = isReceiptPeriod ? firestore_2.Timestamp.fromDate(cycleEnd) : undefined;
    return {
        amountEarned: Math.round(amountEarned * 100) / 100, // Round to 2 decimal places
        amountReceived: Math.round(amountReceived * 100) / 100,
        isReceiptPeriod,
        receiptDate
    };
}
/**
 * Efficiently create multiple inflow_periods using Firestore batch operations
 */
async function batchCreateInflowPeriods(db, inflowPeriods) {
    const BATCH_SIZE = 500; // Firestore batch limit
    for (let i = 0; i < inflowPeriods.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchPeriods = inflowPeriods.slice(i, i + BATCH_SIZE);
        batchPeriods.forEach((inflowPeriod) => {
            const docRef = db.collection('inflow_periods').doc(inflowPeriod.id);
            batch.set(docRef, inflowPeriod);
        });
        await batch.commit();
        console.log(`Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inflowPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
    }
}
/**
 * Calculate all occurrences of an inflow within a period
 * Similar to outflow occurrence calculation
 */
function calculateAllOccurrencesInPeriod(inflow, sourcePeriod, cycleInfo) {
    const periodStart = sourcePeriod.startDate.toDate();
    const periodEnd = sourcePeriod.endDate.toDate();
    // For now, simple implementation - calculate based on frequency
    let numberOfOccurrences = 0;
    const occurrenceDueDates = [];
    // Calculate occurrences based on cycle days
    const cycleDays = cycleInfo.cycleDays;
    const periodDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    // Estimate number of occurrences
    numberOfOccurrences = Math.max(1, Math.floor(periodDays / cycleDays));
    // Generate occurrence dates
    for (let i = 0; i < numberOfOccurrences; i++) {
        const occurrenceDate = new Date(periodStart);
        occurrenceDate.setDate(occurrenceDate.getDate() + (i * cycleDays));
        occurrenceDueDates.push(firestore_2.Timestamp.fromDate(occurrenceDate));
    }
    return {
        numberOfOccurrences,
        occurrenceDueDates
    };
}
/**
 * Helper function to calculate days in a period
 */
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    const diffMs = end.getTime() - start.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end day
}
//# sourceMappingURL=onInflowCreated.js.map