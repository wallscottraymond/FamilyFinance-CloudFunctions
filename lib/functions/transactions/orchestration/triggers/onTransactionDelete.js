"use strict";
/**
 * Transaction Deletion Trigger
 *
 * Automatically triggered when a transaction is deleted from Firestore.
 * Handles budget spending reversal and cleanup operations.
 *
 * Key Features:
 * - Reverses budget_periods spent amounts when transaction is deleted
 * - Handles split transactions with multiple budget assignments
 * - Ensures budget spending accuracy after transaction removal
 * - Supports both manual and automated transaction deletions
 *
 * Memory: 256MiB, Timeout: 60s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTransactionDelete = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
/**
 * Triggered when a transaction document is deleted
 * Automatically reverses budget spending for the deleted transaction
 */
exports.onTransactionDelete = (0, firestore_1.onDocumentDeleted)({
    document: 'transactions/{transactionId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c;
    try {
        const transactionId = event.params.transactionId;
        const transactionData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!transactionData) {
            console.error('[onTransactionDelete] No transaction data found');
            return;
        }
        console.log(`[onTransactionDelete] Processing transaction deletion: ${transactionId}`, {
            ownerId: transactionData.ownerId,
            amount: (_b = transactionData.splits) === null || _b === void 0 ? void 0 : _b.reduce((sum, split) => sum + split.amount, 0),
            splitCount: ((_c = transactionData.splits) === null || _c === void 0 ? void 0 : _c.length) || 0,
            transactionDate: transactionData.transactionDate
        });
        // Reverse budget spending (pass oldTransaction, no newTransaction)
        try {
            const result = await (0, budgetSpending_1.updateBudgetSpending)({
                oldTransaction: Object.assign(Object.assign({}, transactionData), { id: transactionId }),
                newTransaction: undefined, // Indicates deletion
                userId: transactionData.ownerId,
                groupId: transactionData.groupId
            });
            console.log(`[onTransactionDelete] Budget spending reversed:`, {
                budgetPeriodsUpdated: result.budgetPeriodsUpdated,
                budgetsAffected: result.budgetsAffected,
                periodTypesUpdated: result.periodTypesUpdated
            });
            if (result.errors.length > 0) {
                console.error('[onTransactionDelete] Errors during budget update:', result.errors);
            }
        }
        catch (budgetError) {
            console.error('[onTransactionDelete] Budget spending reversal failed:', budgetError);
            // Log error but don't throw - deletion should complete even if budget update fails
        }
        console.log(`[onTransactionDelete] Successfully processed transaction deletion: ${transactionId}`);
    }
    catch (error) {
        console.error('[onTransactionDelete] Error processing transaction deletion:', error);
        // Don't throw - we don't want to block transaction deletion
    }
});
//# sourceMappingURL=onTransactionDelete.js.map