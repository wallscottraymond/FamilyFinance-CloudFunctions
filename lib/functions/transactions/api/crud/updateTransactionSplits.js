"use strict";
/**
 * Update Transaction Splits - Callable Cloud Function
 *
 * Callable version of updateTransaction for mobile app usage.
 * Updates transaction splits with budget assignment and validation.
 *
 * Memory: 256MiB, Timeout: 30s
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
exports.updateTransactionSplits = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("../../../../utils/firestore");
const admin = __importStar(require("firebase-admin"));
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
    const { transactionId, splits, userNotes, isHidden, isRecurring } = request.data;
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
        // Prepare update data - use Record type for flexibility with optional fields
        const updateData = {
            splits,
            updatedAt: admin.firestore.Timestamp.now(),
            updatedBy: userId,
        };
        // Add optional fields if provided
        if (userNotes !== undefined) {
            updateData.userNotes = userNotes;
        }
        if (isHidden !== undefined) {
            updateData.isHidden = isHidden;
        }
        if (isRecurring !== undefined) {
            updateData.isRecurring = isRecurring;
        }
        // Calculate split totals
        const totalAllocated = splits.reduce((sum, split) => sum + Math.abs(split.amount || 0), 0);
        updateData.isSplit = splits.length > 1;
        updateData.totalAllocated = totalAllocated;
        // Budget assignment is owned by the Transaction Assignment Engine:
        // `on_transaction_written` re-runs the engine after this write, which matches
        // each split to a budget on its DETAILED category (the `internalDetailedCategory`
        // normalized below). So we do NOT pre-assign budgets here — we only normalize
        // the splits (ids, category inheritance, the categoryId→internalDetailedCategory
        // translation) so the engine's category match re-homes correctly. (Inline
        // matcher removed 2026-07-27.)
        // Ensure all splits have required fields
        const txn = existingTransaction;
        updateData.splits = updateData.splits.map((split, index) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const now = admin.firestore.Timestamp.now();
            const splitId = split.splitId || split.id || `split_${Date.now()}_${index}`;
            // The split-edit UI sends the user's chosen category as `categoryId`
            // (the detailed Plaid enum, e.g. FOOD_AND_DRINK_GROCERIES) but does NOT
            // write the `internalDetailedCategory` field the assignment engine matches
            // on. Treat an explicit categoryId as the internalDetailedCategory
            // override so editing a split's category actually re-homes it.
            const chosenCategory = typeof split.categoryId === "string" &&
                split.categoryId.trim() !== "" &&
                split.categoryId.toLowerCase() !== "other"
                ? split.categoryId
                : null;
            return Object.assign(Object.assign({}, split), { 
                // Ensure ID exists (support both splitId and id field names)
                splitId: splitId, id: splitId, 
                // Inherit the category from the parent transaction when a (manually
                // added) split doesn't carry one — the assignment engine matches a
                // budget on the split's DETAILED category, so a category-less split
                // would otherwise fall to "Everything Else".
                plaidPrimaryCategory: (_b = (_a = split.plaidPrimaryCategory) !== null && _a !== void 0 ? _a : txn.plaidPrimaryCategory) !== null && _b !== void 0 ? _b : null, plaidDetailedCategory: (_d = (_c = split.plaidDetailedCategory) !== null && _c !== void 0 ? _c : txn.plaidDetailedCategory) !== null && _d !== void 0 ? _d : null, internalPrimaryCategory: (_f = (_e = split.internalPrimaryCategory) !== null && _e !== void 0 ? _e : txn.internalPrimaryCategory) !== null && _f !== void 0 ? _f : null, 
                // Chosen category (UI categoryId) wins → re-homes on edit; else keep the
                // split's existing override, else inherit the parent transaction's.
                internalDetailedCategory: (_h = (_g = chosenCategory !== null && chosenCategory !== void 0 ? chosenCategory : split.internalDetailedCategory) !== null && _g !== void 0 ? _g : txn.internalDetailedCategory) !== null && _h !== void 0 ? _h : null, 
                // Ensure timestamps
                createdAt: split.createdAt || now, updatedAt: now, 
                // Ensure createdBy
                createdBy: split.createdBy || userId });
        });
        // Split-Status-Actions: denormalize expected-returns aggregates from the final
        // splits (status derived from spendStatus, falling back to legacy booleans).
        const deriveStatus = (s) => (typeof s.spendStatus === "string" && s.spendStatus) ||
            (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted");
        updateData.returnAmount = updateData.splits.reduce((sum, s) => sum + (deriveStatus(s) === "refund" ? Math.abs(s.amount || 0) : 0), 0);
        updateData.hasRefundSplits = updateData.splits.some((s) => deriveStatus(s) === "refund");
        updateData.hasIgnoredSplits = updateData.splits.some((s) => deriveStatus(s) === "ignored");
        console.log(`[updateTransactionSplits] Splits assigned - budgetIds: ${updateData.splits.map((s) => s.budgetId).join(', ')}`);
        // Update transaction in Firestore (using Admin SDK - bypasses security rules)
        const updatedTransaction = await (0, firestore_1.updateDocument)("transactions", transactionId, updateData);
        console.log(`[updateTransactionSplits] Transaction ${transactionId} updated successfully`);
        // Budget spend is owned by the Transaction Assignment Engine: the
        // `on_transaction_written` trigger enqueues `assign_transaction`, which
        // fans out `recompute_budget_spent` jobs. No inline increment here.
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
        throw new https_1.HttpsError("internal", "Failed to update transaction splits");
    }
});
//# sourceMappingURL=updateTransactionSplits.js.map