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
exports.cleanupDeletedBudgets = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
/**
 * Scheduled function to permanently delete budgets past their grace period
 *
 * Runs daily at 3:00 AM UTC.
 * Finds all budgets where:
 * - flaggedForDeletion: true
 * - deletionScheduledAt < now
 *
 * Then permanently deletes:
 * - The budget document
 * - All associated budget_periods
 * - Removes from user_summaries
 */
exports.cleanupDeletedBudgets = (0, scheduler_1.onSchedule)({
    schedule: "0 3 * * *", // Daily at 3:00 AM UTC
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540, // 9 minutes
}, async () => {
    console.log("[cleanupDeletedBudgets] Starting cleanup of expired deleted budgets");
    const now = admin.firestore.Timestamp.now();
    try {
        // Find all budgets flagged for deletion where grace period has expired
        const expiredBudgetsSnapshot = await db
            .collection("budgets")
            .where("flaggedForDeletion", "==", true)
            .where("deletionScheduledAt", "<=", now)
            .get();
        if (expiredBudgetsSnapshot.empty) {
            console.log("[cleanupDeletedBudgets] No expired deleted budgets to clean up");
            return;
        }
        console.log(`[cleanupDeletedBudgets] Found ${expiredBudgetsSnapshot.size} budgets to permanently delete`);
        let totalBudgetsDeleted = 0;
        let totalPeriodsDeleted = 0;
        for (const budgetDoc of expiredBudgetsSnapshot.docs) {
            const budgetId = budgetDoc.id;
            const budgetData = budgetDoc.data();
            const userId = budgetData.createdBy;
            console.log(`[cleanupDeletedBudgets] Permanently deleting budget: ${budgetId} (${budgetData.name})`);
            try {
                // Delete all budget_periods for this budget
                const periodsSnapshot = await db
                    .collection("budget_periods")
                    .where("budgetId", "==", budgetId)
                    .get();
                if (!periodsSnapshot.empty) {
                    let batch = db.batch();
                    let batchCount = 0;
                    for (const periodDoc of periodsSnapshot.docs) {
                        batch.delete(periodDoc.ref);
                        batchCount++;
                        if (batchCount >= 500) {
                            await batch.commit();
                            totalPeriodsDeleted += batchCount;
                            batch = db.batch();
                            batchCount = 0;
                        }
                    }
                    if (batchCount > 0) {
                        await batch.commit();
                        totalPeriodsDeleted += batchCount;
                    }
                    console.log(`[cleanupDeletedBudgets] Deleted ${periodsSnapshot.size} budget_periods for budget: ${budgetId}`);
                }
                // Remove from user_summaries
                if (userId) {
                    const userSummaryRef = db.collection("user_summaries").doc(userId);
                    const userSummaryDoc = await userSummaryRef.get();
                    if (userSummaryDoc.exists) {
                        const summaryData = userSummaryDoc.data();
                        if ((summaryData === null || summaryData === void 0 ? void 0 : summaryData.budgetsSummary) && Array.isArray(summaryData.budgetsSummary)) {
                            const updatedBudgetsSummary = summaryData.budgetsSummary.filter((b) => b.budgetId !== budgetId);
                            if (updatedBudgetsSummary.length !== summaryData.budgetsSummary.length) {
                                await userSummaryRef.update({
                                    budgetsSummary: updatedBudgetsSummary,
                                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                                });
                                console.log(`[cleanupDeletedBudgets] Removed budget from user_summaries for user: ${userId}`);
                            }
                        }
                    }
                }
                // Delete the budget document
                await budgetDoc.ref.delete();
                totalBudgetsDeleted++;
                console.log(`[cleanupDeletedBudgets] Successfully deleted budget: ${budgetId}`);
            }
            catch (budgetError) {
                console.error(`[cleanupDeletedBudgets] Error deleting budget ${budgetId}:`, budgetError);
                // Continue with other budgets
            }
        }
        console.log(`[cleanupDeletedBudgets] Cleanup complete. Deleted ${totalBudgetsDeleted} budgets and ${totalPeriodsDeleted} budget_periods`);
    }
    catch (error) {
        console.error("[cleanupDeletedBudgets] Error during cleanup:", error);
        throw error;
    }
});
//# sourceMappingURL=cleanupDeletedBudgets.js.map