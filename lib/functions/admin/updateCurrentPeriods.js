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
exports.updateCurrentPeriods = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../types");
/**
 * Scheduled function that runs daily at midnight UTC to update the isCurrent flag
 * for source periods based on the current date.
 *
 * This function:
 * 1. Sets ALL periods to isCurrent: false first
 * 2. Finds and sets current periods to isCurrent: true for each type:
 *    - Current monthly period (contains today's date)
 *    - Current weekly period (contains today's date)
 *    - Current bi-monthly period (contains today's date)
 * 3. Uses batch writes for efficient operations
 * 4. Logs which periods were updated
 */
exports.updateCurrentPeriods = (0, scheduler_1.onSchedule)({
    schedule: "0 0 * * *", // Daily at midnight UTC (00:00)
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300 // 5 minutes timeout
}, async (event) => {
    const db = admin.firestore();
    const today = admin.firestore.Timestamp.now();
    firebase_functions_1.logger.info("Starting updateCurrentPeriods function", {
        timestamp: today.toDate().toISOString(),
        schedule: event.scheduleTime
    });
    try {
        // Step 1: Get all source periods
        const sourcePeriodsRef = db.collection("source_periods");
        const allPeriodsSnapshot = await sourcePeriodsRef.get();
        if (allPeriodsSnapshot.empty) {
            firebase_functions_1.logger.warn("No source periods found in the database");
            return;
        }
        firebase_functions_1.logger.info(`Found ${allPeriodsSnapshot.size} source periods to process`);
        // Step 2: Set up batch processing constants
        const maxBatchSize = 500; // Firestore batch limit
        // Track periods that will be marked as current
        const currentPeriods = {
            [types_1.PeriodType.MONTHLY]: null,
            [types_1.PeriodType.WEEKLY]: null,
            [types_1.PeriodType.BI_MONTHLY]: null
        };
        // Step 3: Process all periods and find current ones
        const allPeriods = [];
        allPeriodsSnapshot.forEach((doc) => {
            const period = Object.assign({ id: doc.id }, doc.data());
            allPeriods.push(period);
            // Check if this period contains today's date
            const isCurrentPeriod = today.toDate() >= period.startDate.toDate() &&
                today.toDate() <= period.endDate.toDate();
            if (isCurrentPeriod) {
                currentPeriods[period.type] = period;
            }
        });
        // Step 4: Determine which periods need updates
        const updatesToFalse = [];
        const updatesToTrue = [];
        const updatedPeriods = [];
        for (const period of allPeriods) {
            const shouldBeCurrent = Object.values(currentPeriods).some(cp => (cp === null || cp === void 0 ? void 0 : cp.id) === period.id);
            if (period.isCurrent && !shouldBeCurrent) {
                // Currently true but should be false
                updatesToFalse.push(period);
            }
            else if (!period.isCurrent && shouldBeCurrent) {
                // Currently false but should be true  
                updatesToTrue.push(period);
                const periodType = Object.keys(currentPeriods).find(key => { var _a; return ((_a = currentPeriods[key]) === null || _a === void 0 ? void 0 : _a.id) === period.id; });
                updatedPeriods.push(`${periodType}: ${period.periodId}`);
            }
        }
        // Step 5: Apply all updates in efficient batches
        const allUpdates = [
            ...updatesToFalse.map(p => ({ period: p, isCurrent: false })),
            ...updatesToTrue.map(p => ({ period: p, isCurrent: true }))
        ];
        if (allUpdates.length === 0) {
            firebase_functions_1.logger.info("No period updates needed - all periods already have correct isCurrent status");
            return;
        }
        // Process updates in batches
        for (let i = 0; i < allUpdates.length; i += maxBatchSize) {
            const batchUpdates = allUpdates.slice(i, i + maxBatchSize);
            const updateBatch = db.batch();
            batchUpdates.forEach(({ period, isCurrent }) => {
                updateBatch.update(sourcePeriodsRef.doc(period.id), {
                    isCurrent,
                    updatedAt: today
                });
            });
            await updateBatch.commit();
            firebase_functions_1.logger.info(`Committed batch ${Math.floor(i / maxBatchSize) + 1}: ${batchUpdates.length} updates`);
        }
        // Log details of current periods
        for (const [periodType, currentPeriod] of Object.entries(currentPeriods)) {
            if (currentPeriod) {
                firebase_functions_1.logger.info(`Current ${periodType} period`, {
                    periodId: currentPeriod.periodId,
                    startDate: currentPeriod.startDate.toDate().toISOString(),
                    endDate: currentPeriod.endDate.toDate().toISOString(),
                    year: currentPeriod.year,
                    index: currentPeriod.index
                });
            }
            else {
                firebase_functions_1.logger.warn(`No current ${periodType} period found for today`, {
                    today: today.toDate().toISOString()
                });
            }
        }
        // Step 6: Log summary
        const summary = {
            totalPeriodsProcessed: allPeriods.length,
            totalUpdatesApplied: allUpdates.length,
            periodsSetToFalse: updatesToFalse.length,
            periodsSetToTrue: updatesToTrue.length,
            currentPeriods: updatedPeriods,
            executionTime: Date.now() - today.toMillis(),
            timestamp: today.toDate().toISOString()
        };
        firebase_functions_1.logger.info("updateCurrentPeriods function completed successfully", summary);
    }
    catch (error) {
        firebase_functions_1.logger.error("Error in updateCurrentPeriods function", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: today.toDate().toISOString()
        });
        // Re-throw to ensure the function is marked as failed for retry
        throw error;
    }
});
//# sourceMappingURL=updateCurrentPeriods.js.map