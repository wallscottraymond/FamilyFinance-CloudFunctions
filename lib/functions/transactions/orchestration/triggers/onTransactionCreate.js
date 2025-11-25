"use strict";
/**
 * Transaction Creation Trigger
 *
 * Automatically triggered when a new transaction is created in Firestore.
 * Handles budget spending updates and other post-creation orchestration tasks.
 *
 * Key Features:
 * - Updates budget_periods spent amounts based on transaction splits
 * - Handles both manual and Plaid-imported transactions
 * - Supports split transactions with multiple budget assignments
 * - Integrates with existing budget spending calculation logic
 *
 * Memory: 256MiB, Timeout: 60s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTransactionCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
/**
 * Triggered when a transaction document is created
 * Automatically updates budget spending based on transaction splits
 */
exports.onTransactionCreate = (0, firestore_1.onDocumentCreated)({
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
            console.error('[onTransactionCreate] No transaction data found');
            return;
        }
        console.log(`[onTransactionCreate] Processing new transaction: ${transactionId}`, {
            ownerId: transactionData.ownerId,
            amount: (_b = transactionData.splits) === null || _b === void 0 ? void 0 : _b.reduce((sum, split) => sum + split.amount, 0),
            splitCount: ((_c = transactionData.splits) === null || _c === void 0 ? void 0 : _c.length) || 0,
            transactionDate: transactionData.transactionDate
        });
        // Update budget spending based on transaction splits
        try {
            const result = await (0, budgetSpending_1.updateBudgetSpending)({
                newTransaction: Object.assign(Object.assign({}, transactionData), { id: transactionId }),
                userId: transactionData.ownerId,
                groupId: transactionData.groupId
            });
            console.log(`[onTransactionCreate] Budget spending updated:`, {
                budgetPeriodsUpdated: result.budgetPeriodsUpdated,
                budgetsAffected: result.budgetsAffected,
                periodTypesUpdated: result.periodTypesUpdated
            });
            if (result.errors.length > 0) {
                console.error('[onTransactionCreate] Errors during budget update:', result.errors);
            }
        }
        catch (budgetError) {
            console.error('[onTransactionCreate] Budget spending update failed:', budgetError);
            // Don't throw - we don't want to block transaction creation if budget update fails
        }
        console.log(`[onTransactionCreate] Successfully processed transaction: ${transactionId}`);
    }
    catch (error) {
        console.error('[onTransactionCreate] Error processing transaction creation:', error);
        // Don't throw - we don't want to fail the transaction creation
    }
});
//# sourceMappingURL=onTransactionCreate.js.map