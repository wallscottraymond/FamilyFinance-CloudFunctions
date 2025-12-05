"use strict";
/**
 * Update Outflow Period Summary
 *
 * Updates user_summaries document when an outflow period is updated.
 * Called from onOutflowPeriodUpdate trigger.
 *
 * Per-user design: Each user has separate summary documents, so updates
 * won't block each other even under heavy concurrent load.
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
exports.updateOutflowPeriodSummary = updateOutflowPeriodSummary;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const periodTypeHelpers_1 = require("../utils/periodTypeHelpers");
/**
 * Update a single outflow entry in the user's summary document
 *
 * @param periodData - The updated outflow period data
 */
async function updateOutflowPeriodSummary(periodData) {
    console.log('[updateOutflowPeriodSummary] Updating summary for period:', periodData.id);
    try {
        const db = admin.firestore();
        // Step 1: Determine period type from sourcePeriodId
        const periodType = (0, periodTypeHelpers_1.determinePeriodType)(periodData.sourcePeriodId);
        // Step 2: Build document ID for user_summaries
        // Format: {userId}_{periodType}_{sourcePeriodId}
        const summaryId = `${periodData.ownerId}_${periodType.toLowerCase()}_${periodData.sourcePeriodId}`;
        console.log(`[updateOutflowPeriodSummary] Target document: ${summaryId}`);
        // Step 3: Fetch parent outflow for merchant/userCustomName (outside transaction)
        const outflowDoc = await db.collection('outflows').doc(periodData.outflowId).get();
        if (!outflowDoc.exists) {
            console.warn(`[updateOutflowPeriodSummary] ⚠️  Outflow ${periodData.outflowId} not found, skipping`);
            return; // Don't fail the trigger, just skip summary update
        }
        const outflow = outflowDoc.data();
        // Step 4: Build OutflowEntry from period + outflow data
        const updatedEntry = buildOutflowEntry(periodData, outflow);
        // Step 5: Use transaction to prevent race conditions
        const summaryRef = db.collection('user_summaries').doc(summaryId);
        const now = firestore_1.Timestamp.now();
        await db.runTransaction(async (transaction) => {
            const summaryDoc = await transaction.get(summaryRef);
            let outflowsArray = [];
            if (summaryDoc.exists) {
                // Document exists - get current outflows array
                const summaryData = summaryDoc.data();
                outflowsArray = (summaryData === null || summaryData === void 0 ? void 0 : summaryData.outflows) || [];
            }
            else {
                console.log(`[updateOutflowPeriodSummary] Summary doesn't exist, will create new`);
            }
            // Find and update (or add) the specific entry
            const entryIndex = outflowsArray.findIndex(entry => entry.outflowPeriodId === periodData.id);
            if (entryIndex >= 0) {
                console.log(`[updateOutflowPeriodSummary] Updating existing entry at index ${entryIndex}`);
                outflowsArray[entryIndex] = updatedEntry;
            }
            else {
                console.log(`[updateOutflowPeriodSummary] Adding new entry`);
                outflowsArray.push(updatedEntry);
            }
            // Write back to Firestore within transaction
            if (summaryDoc.exists) {
                // Update existing document
                transaction.update(summaryRef, {
                    outflows: outflowsArray,
                    updatedAt: now,
                    lastRecalculated: now
                });
            }
            else {
                // Create new document with proper structure
                transaction.set(summaryRef, {
                    id: summaryId,
                    userId: periodData.ownerId,
                    sourcePeriodId: periodData.sourcePeriodId,
                    periodType: periodType,
                    periodStartDate: periodData.periodStartDate,
                    periodEndDate: periodData.periodEndDate,
                    year: periodData.periodStartDate.toDate().getFullYear(),
                    month: periodData.periodStartDate.toDate().getMonth() + 1,
                    outflows: outflowsArray,
                    budgets: [], // Initialize empty arrays for other resources
                    inflows: [],
                    goals: [],
                    lastRecalculated: now,
                    createdAt: now,
                    updatedAt: now
                });
            }
        });
        console.log(`[updateOutflowPeriodSummary] ✓ Successfully updated ${summaryId}`);
    }
    catch (error) {
        console.error('[updateOutflowPeriodSummary] ❌ Error:', error);
        throw error;
    }
}
/**
 * Build OutflowEntry from OutflowPeriod + Outflow data
 */
function buildOutflowEntry(period, outflow) {
    // Calculate payment progress
    const paymentProgressPercentage = period.totalAmountDue > 0
        ? Math.round((period.totalAmountPaid / period.totalAmountDue) * 100)
        : 0;
    return {
        // Identity
        outflowPeriodId: period.id, // CRITICAL: Used to find entry for updates
        outflowId: outflow.id,
        groupId: period.groupId || '',
        merchant: outflow.merchantName || outflow.description || 'Unknown',
        userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',
        description: outflow.description || outflow.merchantName || 'Unknown',
        // Amounts
        totalAmountDue: period.totalAmountDue || 0,
        totalAmountPaid: period.totalAmountPaid || 0,
        totalAmountUnpaid: period.totalAmountUnpaid || 0,
        totalAmountWithheld: period.amountWithheld || 0,
        averageAmount: period.averageAmount || 0,
        // Due status
        isDuePeriod: period.isDuePeriod || false,
        duePeriodCount: period.isDuePeriod ? 1 : 0,
        dueDate: period.dueDate,
        status: period.status || types_1.OutflowPeriodStatus.PENDING,
        // Progress metrics
        paymentProgressPercentage,
        fullyPaidCount: period.isFullyPaid ? 1 : 0,
        unpaidCount: (!period.isFullyPaid && !period.isPartiallyPaid) ? 1 : 0,
        itemCount: 1
    };
}
//# sourceMappingURL=updateOutflowPeriodSummary.js.map