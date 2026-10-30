"use strict";
/**
 * Update Transaction Splits - Callable Cloud Function
 *
 * Callable version of updateTransaction for mobile app usage.
 * Updates transaction splits with budget assignment and validation.
 *
 * Memory: 256MiB, Timeout: 30s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTransactionSplits = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("../../../../utils/firestore");
const observability_1 = require("../../../observability");
const update_transaction_splits_orchestrator_1 = require("../../../orchestrators/transactions/update_transaction_splits.orchestrator");
/**
 * Update transaction splits via callable function
 *
 * This function:
 * 1. Validates user authentication and ownership
 * 2. Validates and assigns splits to budgets
 * 3. Updates the transaction in Firestore
 * 4. Updates budget spending calculations
 */
exports.updateTransactionSplits = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    // Check authentication
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;
    const { transactionId, splits, userNotes, isRecurring, baseUpdatedAtMs } = request.data;
    // Validate required fields
    if (!transactionId) {
        throw new https_1.HttpsError("invalid-argument", "Transaction ID is required");
    }
    if (!splits || !Array.isArray(splits)) {
        throw new https_1.HttpsError("invalid-argument", "Splits array is required");
    }
    try {
        console.log(`[updateTransactionSplits] User ${userId} updating transaction ${transactionId} with ${splits.length} splits`);
        // Get existing transaction
        const existingTransaction = await (0, firestore_1.getDocument)("transactions", transactionId);
        if (!existingTransaction) {
            throw new https_1.HttpsError("not-found", "Transaction not found");
        }
        // Check ownership - user can only update their own transactions
        if (existingTransaction.ownerId !== userId && existingTransaction.userId !== userId) {
            console.log(`[updateTransactionSplits] Permission denied: user ${userId} does not own transaction ${transactionId}`);
            console.log(`[updateTransactionSplits] Transaction ownerId: ${existingTransaction.ownerId}, userId: ${existingTransaction.userId}`);
            throw new https_1.HttpsError("permission-denied", "Cannot update this transaction");
        }
        // The parts can never add up to MORE than the transaction (else the extra is counted in
        // budgets as money that was never spent). Any app version passes through here.
        const txn_total = Math.abs(Number(existingTransaction.amount) || 0);
        const parts_total = splits.reduce((t, s) => t + Math.abs(Number(s.amount) || 0), 0);
        if (txn_total > 0 && parts_total > txn_total + 0.01) {
            throw new https_1.HttpsError("invalid-argument", `The splits add up to ${parts_total.toFixed(2)}, more than the transaction's ${txn_total.toFixed(2)}`);
        }
        // Applied immediately, in memory, written once (orchestrators/transactions/
        // update_transaction_splits — canon O2 / M3, Transaction-Integrity-Review 3g).
        const updatedTransaction = await (0, update_transaction_splits_orchestrator_1.update_transaction_splits_orchestrator)((0, observability_1.create_trace_context)(false), {
            user_id: userId,
            transaction_id: transactionId,
            txn: existingTransaction,
            splits: splits,
            user_notes: userNotes,
            is_recurring: isRecurring,
            base_updated_at_ms: typeof baseUpdatedAtMs === "number" ? baseUpdatedAtMs : undefined,
        });
        return {
            success: true,
            transaction: updatedTransaction,
            message: "Transaction updated successfully"
        };
    }
    catch (error) {
        console.error("[updateTransactionSplits] Error:", error);
        // Re-throw HttpsErrors as-is
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        if (error instanceof update_transaction_splits_orchestrator_1.StaleSplitEditError) {
            // The app re-reads the transaction and re-applies the edit.
            throw new https_1.HttpsError("aborted", "This transaction just changed. Reload and try again.");
        }
        throw new https_1.HttpsError("internal", "Failed to update transaction splits");
    }
});
//# sourceMappingURL=updateTransactionSplits.js.map