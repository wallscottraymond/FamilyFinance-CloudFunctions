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
/**
 * Recalculate all outflow period entries for a specific sourcePeriodId
 *
 * This is the core aggregation function that:
 * 1. Queries all outflow_periods with the given sourcePeriodId
 * 2. Groups them by outflowId (multiple periods can exist for same outflow)
 * 3. Fetches parent outflow data for merchant/userCustomName
 * 4. Aggregates amounts, statuses, and metrics across all periods
 * 5. Returns array of OutflowPeriodEntry objects ready for batch write
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
        // Step 2: Group periods by outflowId
        const periodsByOutflow = new Map();
        periodsQuery.forEach(doc => {
            const period = Object.assign({ id: doc.id }, doc.data());
            const outflowId = period.outflowId;
            if (!periodsByOutflow.has(outflowId)) {
                periodsByOutflow.set(outflowId, []);
            }
            periodsByOutflow.get(outflowId).push(period);
        });
        console.log(`📦 Grouped into ${periodsByOutflow.size} unique outflows`);
        // Step 3: Process each outflow group and build OutflowPeriodEntry
        const entries = [];
        for (const [outflowId, periods] of periodsByOutflow.entries()) {
            try {
                // Fetch parent outflow for merchant/userCustomName
                const outflowDoc = await db.collection('outflows').doc(outflowId).get();
                if (!outflowDoc.exists) {
                    console.warn(`⚠️ Outflow ${outflowId} not found, skipping periods`);
                    continue;
                }
                const outflow = outflowDoc.data();
                // Aggregate data across all periods for this outflow
                const entry = aggregatePeriods(periods, outflow);
                entries.push(entry);
                console.log(`✅ Aggregated ${periods.length} periods for outflow: ${outflow.merchantName || outflow.description}`);
            }
            catch (error) {
                console.error(`❌ Error processing outflow ${outflowId}:`, error);
                // Continue with other outflows even if one fails
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
 * Aggregate multiple outflow periods into a single OutflowPeriodEntry
 *
 * @param periods - Array of outflow periods for the same outflow
 * @param outflow - Parent outflow document
 * @returns Aggregated OutflowPeriodEntry
 */
function aggregatePeriods(periods, outflow) {
    // Use the first period as the base (they all have the same outflow)
    const firstPeriod = periods[0];
    // Initialize aggregation variables
    let totalAmountDue = 0;
    let totalAmountPaid = 0;
    let totalAmountUnpaid = 0;
    let totalAmountWithheld = 0;
    let duePeriodCount = 0;
    let fullyPaidCount = 0;
    let unpaidCount = 0;
    const statusCounts = {};
    // Aggregate across all periods
    periods.forEach(period => {
        totalAmountDue += period.totalAmountDue || 0;
        totalAmountPaid += period.totalAmountPaid || 0;
        totalAmountUnpaid += period.totalAmountUnpaid || 0;
        totalAmountWithheld += period.amountWithheld || 0;
        if (period.isDuePeriod) {
            duePeriodCount++;
        }
        if (period.isFullyPaid) {
            fullyPaidCount++;
        }
        if (!period.isFullyPaid && !period.isPartiallyPaid) {
            unpaidCount++;
        }
        // Count statuses
        const status = period.status || types_1.OutflowPeriodStatus.PENDING;
        // Map enum value to uppercase key for OutflowStatusCounts
        const statusKey = status.toUpperCase().replace('_', '_');
        statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;
    });
    // Calculate average amount
    const averageAmount = periods.length > 0
        ? periods.reduce((sum, p) => sum + (p.averageAmount || 0), 0) / periods.length
        : 0;
    // Calculate payment progress percentage
    const paymentProgressPercentage = totalAmountDue > 0
        ? Math.round((totalAmountPaid / totalAmountDue) * 100)
        : 0;
    // Determine if this is a due period (any period is due)
    const isDuePeriod = periods.some(p => p.isDuePeriod);
    // Build the OutflowPeriodEntry
    const entry = {
        // Period Identity
        periodId: firstPeriod.id,
        outflowId: outflow.id,
        groupId: firstPeriod.groupId || '',
        merchant: outflow.merchantName || outflow.description || 'Unknown',
        userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',
        // Amount Totals
        totalAmountDue,
        totalAmountPaid,
        totalAmountUnpaid,
        totalAmountWithheld,
        averageAmount,
        // Due Status
        isDuePeriod,
        duePeriodCount,
        // Status Breakdown
        statusCounts,
        // Progress Metrics
        paymentProgressPercentage,
        fullyPaidCount,
        unpaidCount,
        itemCount: periods.length
    };
    return entry;
}
//# sourceMappingURL=recalculatePeriodGroup.js.map