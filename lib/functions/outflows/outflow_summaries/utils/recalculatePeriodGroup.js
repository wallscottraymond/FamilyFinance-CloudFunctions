"use strict";
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
exports.recalculatePeriodGroup = recalculatePeriodGroup;
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const calculateOutflowPeriodStatus_1 = require("../../outflow_periods/utils/calculateOutflowPeriodStatus");
/**
 * Recalculate all outflow period entries for a specific sourcePeriodId
 *
 * This function:
 * 1. Queries all outflow_periods with the given sourcePeriodId
 * 2. Creates ONE OutflowPeriodEntry for EACH outflow_period
 * 3. Fetches parent outflow data for merchant/userCustomName
 * 4. Returns array of OutflowPeriodEntry objects ready for batch write
 *
 * NOTE: No aggregation! Each outflow_period maps to exactly one entry.
 *
 * @param params - Calculation parameters
 * @returns Array of OutflowPeriodEntry objects for the period group
 */
async function recalculatePeriodGroup(params) {
    const { ownerId, ownerType, periodType, sourcePeriodId } = params;
    const db = admin.firestore();
    console.log(`🔄 Recalculating outflow period group:`, {
        ownerId,
        ownerType,
        periodType,
        sourcePeriodId
    });
    try {
        // Step 1: Query all outflow_periods for this sourcePeriodId
        const periodsQuery = await db.collection('outflow_periods')
            .where('ownerId', '==', ownerId)
            .where('sourcePeriodId', '==', sourcePeriodId)
            .where('periodType', '==', periodType)
            .where('isActive', '==', true)
            .get();
        if (periodsQuery.empty) {
            console.log(`✅ No active outflow periods found for ${sourcePeriodId}`);
            return [];
        }
        console.log(`📊 Found ${periodsQuery.size} outflow periods for ${sourcePeriodId}`);
        // Step 2: Create ONE entry per outflow_period (NO grouping!)
        const entries = [];
        for (const periodDoc of periodsQuery.docs) {
            try {
                const period = Object.assign({ id: periodDoc.id }, periodDoc.data());
                // Fetch parent outflow for merchant/userCustomName
                const outflowDoc = await db.collection('outflows').doc(period.outflowId).get();
                if (!outflowDoc.exists) {
                    console.warn(`⚠️ Outflow ${period.outflowId} not found, skipping period ${period.id}`);
                    continue;
                }
                const outflow = outflowDoc.data();
                // Build entry directly from this ONE period
                const entry = buildPeriodEntry(period, outflow);
                entries.push(entry);
                console.log(`✅ Created entry for period: ${outflow.merchantName || outflow.description}`);
            }
            catch (error) {
                console.error(`❌ Error processing period ${periodDoc.id}:`, error);
                // Continue with other periods even if one fails
            }
        }
        console.log(`✅ Successfully calculated ${entries.length} outflow period entries`);
        return entries;
    }
    catch (error) {
        console.error(`❌ Error recalculating period group for ${sourcePeriodId}:`, error);
        throw error;
    }
}
/**
 * Build OutflowPeriodEntry from a SINGLE outflow period
 * No aggregation - each period is its own entry
 *
 * @param period - Single outflow period document
 * @param outflow - Parent outflow document
 * @returns OutflowPeriodEntry for this single period
 */
function buildPeriodEntry(period, outflow) {
    // Calculate payment progress percentage
    const paymentProgressPercentage = period.totalAmountDue > 0
        ? Math.round((period.totalAmountPaid / period.totalAmountDue) * 100)
        : 0;
    // Calculate enhanced status with occurrence tracking
    const enhancedStatus = (0, calculateOutflowPeriodStatus_1.calculateEnhancedOutflowPeriodStatus)(period.isDuePeriod || false, period.dueDate, period.expectedDueDate || period.dueDate || period.periodStartDate, period.totalAmountDue || 0, period.transactionSplits || [], period.numberOfOccurrencesInPeriod || 0, period.numberOfOccurrencesPaid || 0, period.frequency || 'MONTHLY');
    // Determine status counts from period status
    const statusCounts = {};
    const status = period.status || types_1.OutflowPeriodStatus.PENDING;
    const statusKey = status.toUpperCase().replace('_', '_');
    statusCounts[statusKey] = 1; // This entry represents ONE period
    return {
        // Period Identity
        periodId: period.id,
        outflowId: outflow.id,
        groupId: period.groupId || '',
        merchant: outflow.merchantName || outflow.description || 'Unknown',
        userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',
        // Amount Totals (directly from the ONE period)
        totalAmountDue: period.totalAmountDue || 0,
        totalAmountPaid: period.totalAmountPaid || 0,
        totalAmountUnpaid: period.totalAmountUnpaid || 0,
        totalAmountWithheld: period.amountWithheld || 0,
        averageAmount: period.averageAmount || 0,
        // Due Status
        isDuePeriod: period.isDuePeriod || false,
        duePeriodCount: period.isDuePeriod ? 1 : 0,
        // Status Breakdown
        statusCounts,
        // Progress Metrics
        paymentProgressPercentage,
        fullyPaidCount: period.isFullyPaid ? 1 : 0,
        unpaidCount: (!period.isFullyPaid && !period.isPartiallyPaid) ? 1 : 0,
        itemCount: 1, // This entry represents exactly ONE period
        // Occurrence Tracking (from enhanced status calculation)
        hasOccurrenceTracking: enhancedStatus.hasOccurrenceTracking,
        numberOfOccurrences: enhancedStatus.numberOfOccurrences,
        numberOfOccurrencesPaid: enhancedStatus.numberOfOccurrencesPaid,
        numberOfOccurrencesUnpaid: enhancedStatus.numberOfOccurrencesUnpaid,
        occurrencePaymentPercentage: enhancedStatus.occurrencePaymentPercentage,
        occurrenceStatusText: enhancedStatus.occurrenceStatusText
    };
}
//# sourceMappingURL=recalculatePeriodGroup.js.map