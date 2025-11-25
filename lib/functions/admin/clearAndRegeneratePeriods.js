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
exports.clearAndRegeneratePeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../types");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Clear all existing source periods and regenerate them with proper UTC+0 timezone
 * Admin only function - use with caution!
 */
exports.clearAndRegeneratePeriods = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300, // 5 minutes for large operation
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            // Only admin users can clear and regenerate periods
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.ADMIN);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const db = admin.firestore();
            const sourcePeriodsRef = db.collection("source_periods");
            // Step 1: Delete all existing periods
            console.log("Clearing existing source periods...");
            const existingPeriodsSnapshot = await sourcePeriodsRef.get();
            if (!existingPeriodsSnapshot.empty) {
                const batchSize = 500;
                let batch = db.batch();
                let operationCount = 0;
                for (const doc of existingPeriodsSnapshot.docs) {
                    batch.delete(doc.ref);
                    operationCount++;
                    if (operationCount === batchSize) {
                        await batch.commit();
                        console.log(`Deleted batch of ${operationCount} periods`);
                        batch = db.batch();
                        operationCount = 0;
                    }
                }
                // Commit remaining operations
                if (operationCount > 0) {
                    await batch.commit();
                    console.log(`Deleted final batch of ${operationCount} periods`);
                }
                console.log(`Cleared ${existingPeriodsSnapshot.size} existing periods`);
            }
            else {
                console.log("No existing periods to clear");
            }
            // Step 2: Generate new UTC+0 periods
            console.log("Generating new UTC+0 source periods...");
            const periods = [];
            const today = new Date();
            // Generate periods from 2023 to 2033
            for (let year = 2023; year <= 2033; year++) {
                // Generate monthly periods (UTC+0)
                for (let month = 1; month <= 12; month++) {
                    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
                    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
                    const monthlyPeriod = {
                        id: `${year}M${month.toString().padStart(2, '0')}`,
                        periodId: `${year}M${month.toString().padStart(2, '0')}`,
                        type: types_1.PeriodType.MONTHLY,
                        startDate: admin.firestore.Timestamp.fromDate(startDate),
                        endDate: admin.firestore.Timestamp.fromDate(endDate),
                        year,
                        index: parseInt(`${year}${month.toString().padStart(2, '0')}`),
                        isCurrent: isCurrentPeriod(startDate, endDate, today, types_1.PeriodType.MONTHLY),
                        metadata: {
                            month,
                            weekStartDay: 0
                        }
                    };
                    periods.push(monthlyPeriod);
                    // Generate bi-monthly periods (1st-15th, 16th-end) (UTC+0)
                    const firstHalfEnd = new Date(Date.UTC(year, month - 1, 15, 23, 59, 59, 999));
                    const secondHalfStart = new Date(Date.UTC(year, month - 1, 16, 0, 0, 0, 0));
                    const biMonthlyFirstHalf = {
                        id: `${year}BM${month.toString().padStart(2, '0')}A`,
                        periodId: `${year}BM${month.toString().padStart(2, '0')}A`,
                        type: types_1.PeriodType.BI_MONTHLY,
                        startDate: admin.firestore.Timestamp.fromDate(startDate),
                        endDate: admin.firestore.Timestamp.fromDate(firstHalfEnd),
                        year,
                        index: parseInt(`${year}${month.toString().padStart(2, '0')}1`),
                        isCurrent: isCurrentPeriod(startDate, firstHalfEnd, today, types_1.PeriodType.BI_MONTHLY),
                        metadata: {
                            month,
                            biMonthlyHalf: 1,
                            weekStartDay: 0
                        }
                    };
                    const biMonthlySecondHalf = {
                        id: `${year}BM${month.toString().padStart(2, '0')}B`,
                        periodId: `${year}BM${month.toString().padStart(2, '0')}B`,
                        type: types_1.PeriodType.BI_MONTHLY,
                        startDate: admin.firestore.Timestamp.fromDate(secondHalfStart),
                        endDate: admin.firestore.Timestamp.fromDate(endDate),
                        year,
                        index: parseInt(`${year}${month.toString().padStart(2, '0')}2`),
                        isCurrent: isCurrentPeriod(secondHalfStart, endDate, today, types_1.PeriodType.BI_MONTHLY),
                        metadata: {
                            month,
                            biMonthlyHalf: 2,
                            weekStartDay: 0
                        }
                    };
                    periods.push(biMonthlyFirstHalf, biMonthlySecondHalf);
                }
                // Generate weekly periods (Sunday start) (UTC+0)
                const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
                const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
                // Find the first Sunday of the year or the first day if it's Sunday (UTC)
                let currentWeekStart = new Date(yearStart.getTime());
                while (currentWeekStart.getUTCDay() !== 0) {
                    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 1);
                }
                let weekNumber = 1;
                while (currentWeekStart.getUTCFullYear() === year || currentWeekStart < yearEnd) {
                    const weekEnd = new Date(currentWeekStart.getTime());
                    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
                    weekEnd.setUTCHours(23, 59, 59, 999);
                    // Only include weeks that have some days in the current year (UTC)
                    if (weekEnd.getUTCFullYear() >= year && currentWeekStart.getUTCFullYear() <= year) {
                        // Get the ISO week number for better accuracy
                        const isoWeekNumber = getISOWeekNumber(currentWeekStart);
                        const weeklyPeriod = {
                            id: `${year}W${weekNumber.toString().padStart(2, '0')}`,
                            periodId: `${year}W${weekNumber.toString().padStart(2, '0')}`,
                            type: types_1.PeriodType.WEEKLY,
                            startDate: admin.firestore.Timestamp.fromDate(currentWeekStart),
                            endDate: admin.firestore.Timestamp.fromDate(weekEnd),
                            year,
                            index: parseInt(`${year}${weekNumber.toString().padStart(2, '0')}`),
                            isCurrent: isCurrentPeriod(currentWeekStart, weekEnd, today, types_1.PeriodType.WEEKLY),
                            metadata: {
                                weekNumber: isoWeekNumber,
                                weekStartDay: 0
                            }
                        };
                        periods.push(weeklyPeriod);
                        weekNumber++;
                    }
                    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() + 7);
                }
            }
            // Step 3: Save periods in batches
            console.log(`Saving ${periods.length} periods to Firestore...`);
            const batchSize = 500;
            const now = admin.firestore.Timestamp.now();
            for (let i = 0; i < periods.length; i += batchSize) {
                const batch = db.batch();
                const batchPeriods = periods.slice(i, i + batchSize);
                batchPeriods.forEach(period => {
                    const docRef = sourcePeriodsRef.doc(period.id);
                    const fullPeriod = Object.assign(Object.assign({}, period), { createdAt: now, updatedAt: now });
                    batch.set(docRef, fullPeriod);
                });
                await batch.commit();
                console.log(`Saved batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(periods.length / batchSize)}`);
            }
            console.log(`Successfully generated ${periods.length} total UTC+0 periods`);
            // Return summary
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                message: "Source periods cleared and regenerated successfully with UTC+0 timezone",
                totalPeriods: periods.length,
                breakdown: {
                    monthly: periods.filter(p => p.type === types_1.PeriodType.MONTHLY).length,
                    weekly: periods.filter(p => p.type === types_1.PeriodType.WEEKLY).length,
                    biMonthly: periods.filter(p => p.type === types_1.PeriodType.BI_MONTHLY).length
                },
                samplePeriods: periods.slice(0, 5).map(p => ({
                    id: p.id,
                    type: p.type,
                    startDate: p.startDate.toDate().toISOString(),
                    endDate: p.endDate.toDate().toISOString()
                })),
                yearsGenerated: "2023-2033"
            }));
        }
        catch (error) {
            console.error("Error clearing and regenerating periods:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to clear and regenerate source periods"));
        }
    });
});
// Helper functions
function isCurrentPeriod(startDate, endDate, today, type) {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    const todayTime = today.getTime();
    return todayTime >= startTime && todayTime <= endTime;
}
function getISOWeekNumber(date) {
    const target = new Date(date.valueOf());
    const dayNr = (date.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setUTCMonth(0, 1);
    if (target.getUTCDay() !== 4) {
        target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}
//# sourceMappingURL=clearAndRegeneratePeriods.js.map