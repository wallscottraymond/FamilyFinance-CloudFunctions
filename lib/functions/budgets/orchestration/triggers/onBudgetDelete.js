"use strict";
/**
 * Budget Deletion Trigger - Auto-Recreation Safety Net
 *
 * Firestore trigger that fires when a budget document is deleted.
 * Automatically recreates "everything else" budgets if they are deleted
 * (either accidentally or by bypassing Cloud Functions/security rules).
 *
 * This is a safety net to ensure users always have an "everything else" budget.
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
exports.onBudgetDelete = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const index_1 = require("../../../../index");
const createEverythingElseBudget_1 = require("../../utils/createEverythingElseBudget");
/**
 * Trigger: Budget document deleted
 *
 * Monitors budget deletions and automatically recreates "everything else" budgets
 * if they are deleted (safety net for direct Firestore access).
 *
 * **Process:**
 * 1. Check if deleted budget is a system "everything else" budget
 * 2. If yes, recreate it immediately for the user
 * 3. If no, do nothing (normal budget deletion)
 *
 * **Safety Net Scenarios:**
 * - User manually deletes from Firestore console
 * - Admin bypasses security rules
 * - Bug in deletion prevention logic
 * - Direct API access circumventing protections
 */
exports.onBudgetDelete = (0, firestore_1.onDocumentDeleted)({
    document: 'budgets/{budgetId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a;
    const budgetId = event.params.budgetId;
    const budgetData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    console.log(`🗑️ [onBudgetDelete] Budget deleted: ${budgetId}`);
    // 1. Check if event data exists
    if (!budgetData) {
        console.warn(`⚠️ [onBudgetDelete] No data available for deleted budget: ${budgetId}`);
        return;
    }
    // 2. Extract user information
    const userId = budgetData.createdBy;
    if (!userId) {
        console.error(`❌ [onBudgetDelete] Cannot process deletion: missing createdBy field`);
        return;
    }
    // 3. Reassign transactions from deleted budget to active budgets
    // This runs for ALL budget deletions (regular and system)
    console.log(`🔄 [onBudgetDelete] Reassigning transactions from deleted budget ${budgetId} for user ${userId}`);
    try {
        const { reassignTransactionsFromDeletedBudget } = await Promise.resolve().then(() => __importStar(require('../../utils/reassignTransactionsFromDeletedBudget')));
        const result = await reassignTransactionsFromDeletedBudget(budgetId, userId);
        if (result.success) {
            console.log(`✅ [onBudgetDelete] Transaction reassignment completed:`, {
                transactionsReassigned: result.transactionsReassigned,
                budgetAssignments: result.budgetAssignments,
                batchCount: result.batchCount,
                errors: result.errors.length
            });
        }
        else {
            console.error(`❌ [onBudgetDelete] Transaction reassignment failed:`, result.error);
        }
    }
    catch (reassignError) {
        console.error(`❌ [onBudgetDelete] Error during transaction reassignment:`, reassignError);
        // Non-blocking - budget deletion completes even if reassignment fails
    }
    // 4. Check if this was a system "everything else" budget
    if (!budgetData.isSystemEverythingElse) {
        console.log(`✅ [onBudgetDelete] Regular budget deleted (not system budget): ${budgetId}`);
        return;
    }
    // 5. System budget was deleted - this should not happen!
    console.warn(`⚠️ [onBudgetDelete] "Everything else" budget deleted for user ${userId}. Recreating...`);
    try {
        // 6. Extract user currency
        const userCurrency = budgetData.currency || 'USD';
        // 7. Recreate the "everything else" budget
        const newBudgetId = await (0, createEverythingElseBudget_1.createEverythingElseBudget)(index_1.db, userId, userCurrency);
        console.log(`✅ [onBudgetDelete] Successfully recreated "everything else" budget for user ${userId}: ${newBudgetId}`);
    }
    catch (error) {
        console.error(`❌ [onBudgetDelete] Failed to recreate "everything else" budget:`, error);
        // Note: We don't throw here - this is a safety net, not a critical operation
        // The user can still use the app, but should manually create the budget
    }
});
//# sourceMappingURL=onBudgetDelete.js.map