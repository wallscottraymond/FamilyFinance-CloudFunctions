"use strict";
/**
 * Transaction Update Trigger
 *
 * Automatically triggered when a transaction is updated in Firestore.
 * Handles budget spending recalculation when transaction details change.
 *
 * Key Features:
 * - Recalculates budget_periods spent amounts based on transaction changes
 * - Handles changes to splits (added, removed, or amount modified)
 * - Supports budget reassignment (moving transaction between budgets)
 * - Reverses old spending and applies new spending atomically
 *
 * Memory: 256MiB, Timeout: 60s
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
exports.onTransactionUpdate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
const admin = __importStar(require("firebase-admin"));
/**
 * Triggered when a transaction document is updated
 * Automatically recalculates budget spending based on changes
 */
exports.onTransactionUpdate = (0, firestore_1.onDocumentUpdated)({
    document: 'transactions/{transactionId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c, _d;
    try {
        const transactionId = event.params.transactionId;
        const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!beforeData || !afterData) {
            console.error('[onTransactionUpdate] Missing transaction data');
            return;
        }
        console.log(`[onTransactionUpdate] Processing transaction update: ${transactionId}`, {
            ownerId: afterData.ownerId,
            oldSplitCount: ((_c = beforeData.splits) === null || _c === void 0 ? void 0 : _c.length) || 0,
            newSplitCount: ((_d = afterData.splits) === null || _d === void 0 ? void 0 : _d.length) || 0,
            transactionDate: afterData.transactionDate
        });
        // Check if spending-related fields have changed
        const hasSpendingChanges = detectSpendingChanges(beforeData, afterData);
        if (!hasSpendingChanges) {
            console.log('[onTransactionUpdate] No spending-related changes detected, skipping budget update');
            return;
        }
        console.log('[onTransactionUpdate] Spending changes detected:', {
            splitsChanged: JSON.stringify(beforeData.splits) !== JSON.stringify(afterData.splits),
            dateChanged: beforeData.transactionDate !== afterData.transactionDate
        });
        // SAFETY NET: Validate and fix splits if they're invalid
        // This catches cases where invalid splits slip through (direct Firestore writes, bugs, etc.)
        if (afterData.splits && afterData.splits.length > 0) {
            const { validateAndRedistributeSplits } = await Promise.resolve().then(() => __importStar(require('../../utils/validateAndRedistributeSplits')));
            // Calculate transaction amount from splits
            const transactionAmount = afterData.splits.reduce((sum, split) => sum + split.amount, 0);
            const validationResult = validateAndRedistributeSplits(transactionAmount, afterData.splits);
            if (!validationResult.isValid && validationResult.redistributedSplits) {
                console.log(`[onTransactionUpdate] Invalid splits detected - auto-fixing: transaction amount=${transactionAmount}`);
                // Update the transaction document with corrected splits
                const { getFirestore } = await Promise.resolve().then(() => __importStar(require('firebase-admin/firestore')));
                const db = getFirestore();
                await db.collection('transactions').doc(transactionId).update({
                    splits: validationResult.redistributedSplits,
                    updatedAt: admin.firestore.Timestamp.now()
                });
                console.log(`[onTransactionUpdate] Splits auto-corrected for transaction ${transactionId}`);
                // Early return - the update will trigger this function again with valid splits
                // Next iteration will have valid splits and proceed to budget update normally
                return;
            }
        }
        // Update budget spending (reverses old and applies new)
        try {
            const result = await (0, budgetSpending_1.updateBudgetSpending)({
                oldTransaction: Object.assign(Object.assign({}, beforeData), { id: transactionId }),
                newTransaction: Object.assign(Object.assign({}, afterData), { id: transactionId }),
                userId: afterData.ownerId,
                groupId: afterData.groupId
            });
            console.log(`[onTransactionUpdate] Budget spending updated:`, {
                budgetPeriodsUpdated: result.budgetPeriodsUpdated,
                budgetsAffected: result.budgetsAffected,
                periodTypesUpdated: result.periodTypesUpdated
            });
            if (result.errors.length > 0) {
                console.error('[onTransactionUpdate] Errors during budget update:', result.errors);
            }
        }
        catch (budgetError) {
            console.error('[onTransactionUpdate] Budget spending update failed:', budgetError);
            // Don't throw - we don't want to block transaction updates if budget update fails
        }
        console.log(`[onTransactionUpdate] Successfully processed transaction update: ${transactionId}`);
    }
    catch (error) {
        console.error('[onTransactionUpdate] Error processing transaction update:', error);
        // Don't throw - we don't want to fail the transaction update
    }
});
/**
 * Detect if spending-related fields have changed
 * Returns true if budget spending needs to be recalculated
 */
function detectSpendingChanges(before, after) {
    var _a, _b;
    // Check if splits have changed
    const splitsBefore = JSON.stringify(before.splits || []);
    const splitsAfter = JSON.stringify(after.splits || []);
    if (splitsBefore !== splitsAfter) {
        return true;
    }
    // Check if transaction date changed (affects which periods get the spending)
    if (((_a = before.transactionDate) === null || _a === void 0 ? void 0 : _a.toMillis()) !== ((_b = after.transactionDate) === null || _b === void 0 ? void 0 : _b.toMillis())) {
        return true;
    }
    // No spending-related changes
    return false;
}
//# sourceMappingURL=onTransactionUpdate.js.map