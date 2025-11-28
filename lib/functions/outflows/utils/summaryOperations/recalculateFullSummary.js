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
exports.recalculateFullSummary = recalculateFullSummary;
exports.buildSummaryId = buildSummaryId;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const recalculatePeriodGroup_1 = require("./recalculatePeriodGroup");
/**
 * Recalculate the entire outflow summary from scratch
 *
 * This function is used for:
 * - Initial summary creation
 * - Full data backfill/migration
 * - Debugging and verification
 * - Recovery from data inconsistencies
 *
 * Process:
 * 1. Query all active outflow_periods in 2-year window
 * 2. Extract unique sourcePeriodIds
 * 3. Call recalculatePeriodGroup() for each sourcePeriodId
 * 4. Build complete periods object grouped by sourcePeriodId
 *
 * @param params - Calculation parameters
 * @returns Complete periods object ready for summary document
 */
async function recalculateFullSummary(params) {
    const { ownerId, ownerType, periodType } = params;
    const db = admin.firestore();
    console.log(`🔄 Recalculating FULL outflow summary:`, {
        ownerId,
        ownerType,
        periodType
    });
    try {
        // Step 1: Define 2-year window (1 year past, 1 year future)
        const now = new Date();
        const windowStart = new Date(now.getFullYear() - 1, 0, 1); // Jan 1 of last year
        const windowEnd = new Date(now.getFullYear() + 1, 11, 31); // Dec 31 of next year
        console.log(`📅 Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);
        // Step 2: Query all active outflow_periods in window
        const periodsQuery = await db.collection('outflow_periods')
            .where('ownerId', '==', ownerId)
            .where('periodType', '==', periodType)
            .where('isActive', '==', true)
            .where('cycleStartDate', '>=', firestore_1.Timestamp.fromDate(windowStart))
            .where('cycleStartDate', '<=', firestore_1.Timestamp.fromDate(windowEnd))
            .get();
        if (periodsQuery.empty) {
            console.log(`✅ No active outflow periods found in window`);
            return {
                periods: {},
                totalItemCount: 0
            };
        }
        console.log(`📊 Found ${periodsQuery.size} total outflow periods in window`);
        // Step 3: Extract unique sourcePeriodIds
        const sourcePeriodIds = new Set();
        periodsQuery.forEach(doc => {
            const sourcePeriodId = doc.data().sourcePeriodId;
            if (sourcePeriodId) {
                sourcePeriodIds.add(sourcePeriodId);
            }
        });
        console.log(`📦 Found ${sourcePeriodIds.size} unique source periods`);
        // Step 4: Recalculate each period group
        const periods = {};
        let totalItemCount = 0;
        for (const sourcePeriodId of Array.from(sourcePeriodIds)) {
            try {
                console.log(`🔄 Recalculating period group: ${sourcePeriodId}`);
                const entries = await (0, recalculatePeriodGroup_1.recalculatePeriodGroup)({
                    ownerId,
                    ownerType,
                    periodType,
                    sourcePeriodId
                });
                if (entries.length > 0) {
                    periods[sourcePeriodId] = entries;
                    totalItemCount += entries.length;
                }
                console.log(`✅ Period ${sourcePeriodId}: ${entries.length} entries`);
            }
            catch (error) {
                console.error(`❌ Error recalculating period ${sourcePeriodId}:`, error);
                // Continue with other periods even if one fails
            }
        }
        console.log(`✅ Full summary recalculation complete:`, {
            uniquePeriods: Object.keys(periods).length,
            totalItemCount
        });
        return {
            periods,
            totalItemCount
        };
    }
    catch (error) {
        console.error(`❌ Error recalculating full summary:`, error);
        throw error;
    }
}
/**
 * Helper function to format summary ID
 */
function buildSummaryId(ownerId, ownerType, periodType) {
    const typeStr = periodType.toLowerCase();
    return `${ownerId}_outflowsummary_${typeStr}`;
}
//# sourceMappingURL=recalculateFullSummary.js.map