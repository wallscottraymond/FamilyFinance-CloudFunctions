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
exports.batchUpdateSummary = batchUpdateSummary;
exports.getSummaryId = getSummaryId;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const recalculatePeriodGroup_1 = require("./recalculatePeriodGroup");
const updatePeriodNames_1 = require("./updatePeriodNames");
const recalculateFullSummary_1 = require("./recalculateFullSummary");
/**
 * Batch Update Summary - Core Orchestration Function
 *
 * Coordinates multiple update operations into a single atomic Firestore write.
 * This ensures all changes succeed or fail together, maintaining data consistency.
 *
 * Supported Operations:
 * - 'recalculate': Recalculate a specific sourcePeriodId group
 * - 'updateNames': Update merchant/userCustomName for an outflow
 *
 * Process:
 * 1. Fetch current summary document (or create if missing)
 * 2. Execute all operations sequentially on in-memory copy
 * 3. Collect all changes
 * 4. Single Firestore batch write with all updates
 * 5. Update metadata (lastRecalculated, updatedAt, totalItemCount)
 *
 * @param params - Batch update parameters
 */
async function batchUpdateSummary(params) {
    const { summaryId, operations } = params;
    const db = admin.firestore();
    console.log(`🔄 Starting batch update for summary: ${summaryId}`, {
        operationCount: operations.length,
        operationTypes: operations.map(op => op.type)
    });
    try {
        // Fetch current summary or prepare new one
        const summaryRef = db.collection('outflow_summary').doc(summaryId);
        const summaryDoc = await summaryRef.get();
        let currentPeriods = {};
        let ownerId = '';
        let ownerType = 'user';
        let periodType = types_1.PeriodType.MONTHLY;
        if (summaryDoc.exists) {
            const summaryData = summaryDoc.data();
            currentPeriods = summaryData.periods || {};
            ownerId = summaryData.ownerId;
            ownerType = summaryData.ownerType;
            periodType = summaryData.periodType;
            console.log(`📖 Loaded existing summary with ${Object.keys(currentPeriods).length} period groups`);
        }
        else {
            console.log(`📝 Summary does not exist, will create new one`);
            // Extract owner info from first recalculate operation
            const firstRecalc = operations.find(op => op.type === 'recalculate');
            if (firstRecalc && firstRecalc.type === 'recalculate') {
                ownerId = firstRecalc.data.ownerId;
                ownerType = firstRecalc.data.ownerType;
                periodType = firstRecalc.data.periodType;
            }
        }
        // Step 2: Execute all operations sequentially on in-memory copy
        let updatedPeriods = Object.assign({}, currentPeriods);
        for (const operation of operations) {
            try {
                if (operation.type === 'recalculate') {
                    const { sourcePeriodId, ownerId, ownerType, periodType } = operation.data;
                    console.log(`🔄 Executing recalculate for period: ${sourcePeriodId}`);
                    const entries = await (0, recalculatePeriodGroup_1.recalculatePeriodGroup)({
                        ownerId,
                        ownerType,
                        periodType,
                        sourcePeriodId
                    });
                    if (entries.length > 0) {
                        updatedPeriods[sourcePeriodId] = entries;
                    }
                    else {
                        // No entries means this period group should be removed
                        delete updatedPeriods[sourcePeriodId];
                    }
                }
                else if (operation.type === 'updateNames') {
                    const { outflowId, merchant, userCustomName } = operation.data;
                    console.log(`🔄 Executing updateNames for outflow: ${outflowId}`);
                    updatedPeriods = (0, updatePeriodNames_1.updatePeriodNames)({
                        currentPeriods: updatedPeriods,
                        outflowId,
                        merchant,
                        userCustomName
                    });
                }
            }
            catch (error) {
                console.error(`❌ Error executing operation ${operation.type}:`, error);
                throw error; // Fail entire batch if any operation fails
            }
        }
        // Step 3: Calculate total item count
        const totalItemCount = Object.values(updatedPeriods).reduce((sum, entries) => sum + entries.length, 0);
        // Step 4: Prepare summary document
        const now = firestore_1.Timestamp.now();
        const windowStart = firestore_1.Timestamp.fromDate(new Date(new Date().getFullYear() - 1, 0, 1));
        const windowEnd = firestore_1.Timestamp.fromDate(new Date(new Date().getFullYear() + 1, 11, 31));
        const summaryData = {
            periods: updatedPeriods,
            totalItemCount,
            lastRecalculated: now,
            updatedAt: now
        };
        // Add creation fields if new document
        if (!summaryDoc.exists) {
            Object.assign(summaryData, {
                ownerId,
                ownerType,
                periodType,
                resourceType: 'outflow',
                windowStart,
                windowEnd,
                createdAt: now
            });
        }
        // Step 5: Write to Firestore
        await summaryRef.set(summaryData, { merge: true });
        console.log(`✅ Batch update complete for ${summaryId}:`, {
            periodGroups: Object.keys(updatedPeriods).length,
            totalItems: totalItemCount,
            operationsExecuted: operations.length
        });
    }
    catch (error) {
        console.error(`❌ Batch update failed for ${summaryId}:`, error);
        throw error;
    }
}
/**
 * Helper function to get or create summary ID
 */
function getSummaryId(ownerId, ownerType, periodType) {
    return (0, recalculateFullSummary_1.buildSummaryId)(ownerId, ownerType, periodType);
}
//# sourceMappingURL=batchUpdateSummary.js.map