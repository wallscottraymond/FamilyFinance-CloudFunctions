"use strict";
/**
 * Batch Transaction Creation Utility
 *
 * Handles atomic batch writing of transactions and outflow period updates to Firestore.
 * This is the final step in the transaction processing pipeline.
 *
 * @module transactions/utils/batch_create_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.batch_create_transactions = batch_create_transactions;
exports.batchCreateTransactions = batch_create_transactions;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
/**
 * Batch create transactions and update outflow periods atomically
 *
 * Creates all transactions and applies outflow period updates in a single
 * batch operation for atomicity.
 *
 * @param transactions - Array of transactions to create
 * @param outflow_updates - Array of outflow period updates to apply
 * @returns Count of successfully created transactions
 */
async function batch_create_transactions(transactions, outflow_updates) {
    var _a, _b;
    console.log(`📦 [batch_create_transactions] Batch creating ${transactions.length} transactions and ${outflow_updates.length} outflow updates`);
    if (transactions.length === 0) {
        console.log(`⏭️ [batch_create_transactions] No transactions to create`);
        return 0;
    }
    const BATCH_SIZE = 500; // Firestore batch limit
    let total_created = 0;
    try {
        // Split into batches if needed
        for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
            const batch = index_1.db.batch();
            const batch_transactions = transactions.slice(i, i + BATCH_SIZE);
            const batch_number = Math.floor(i / BATCH_SIZE) + 1;
            const total_batches = Math.ceil(transactions.length / BATCH_SIZE);
            console.log(`📦 [batch_create_transactions] Processing batch ${batch_number}/${total_batches} (${batch_transactions.length} transactions)`);
            // Add transactions to batch
            for (const transaction of batch_transactions) {
                // Use transactionId field as Firestore document ID
                const transaction_id = transaction.transactionId;
                const doc_ref = index_1.db.collection('transactions').doc(transaction_id);
                // Add createdAt and updatedAt timestamps
                const transaction_data = Object.assign(Object.assign({}, transaction), { id: transaction_id, createdAt: firestore_1.Timestamp.now(), updatedAt: firestore_1.Timestamp.now() });
                // 🔍 DIAGNOSTIC: Log period IDs before writing to Firestore
                console.log(`🔍🔍🔍 [batch_create_transactions] Transaction ${transaction_id} period IDs:`, {
                    split_count: (_a = transaction_data.splits) === null || _a === void 0 ? void 0 : _a.length,
                    first_split_periods: ((_b = transaction_data.splits) === null || _b === void 0 ? void 0 : _b[0]) ? {
                        monthly_period_id: transaction_data.splits[0].monthlyPeriodId,
                        weekly_period_id: transaction_data.splits[0].weeklyPeriodId,
                        bi_weekly_period_id: transaction_data.splits[0].biWeeklyPeriodId,
                    } : 'NO SPLITS'
                });
                batch.set(doc_ref, transaction_data);
            }
            // Add outflow period updates to this batch (if any belong to this batch)
            // We'll apply all outflow updates in the first batch for simplicity
            if (i === 0 && outflow_updates.length > 0) {
                const updates_for_batch = outflow_updates.slice(0, Math.min(outflow_updates.length, BATCH_SIZE - batch_transactions.length));
                for (const update of updates_for_batch) {
                    const period_ref = index_1.db.collection('outflow_periods').doc(update.period_id);
                    // Add transaction split reference to the outflow period (convert to camelCase for Firestore)
                    batch.update(period_ref, {
                        transactionSplits: firestore_1.FieldValue.arrayUnion({
                            transactionId: update.transaction_split_ref.transaction_id,
                            splitId: update.transaction_split_ref.split_id,
                            amount: update.transaction_split_ref.amount,
                            paymentDate: update.transaction_split_ref.payment_date,
                        }),
                        status: 'paid', // Mark as paid when transaction is matched
                        updatedAt: firestore_1.Timestamp.now()
                    });
                }
                console.log(`📦 [batch_create_transactions] Added ${updates_for_batch.length} outflow period updates to batch`);
            }
            // Commit the batch
            await batch.commit();
            total_created += batch_transactions.length;
            console.log(`✅ [batch_create_transactions] Committed batch ${batch_number}/${total_batches}`);
        }
        // Handle remaining outflow updates if they didn't fit in transaction batches
        const remaining_updates = outflow_updates.slice(BATCH_SIZE - transactions.length);
        if (remaining_updates.length > 0) {
            console.log(`📦 [batch_create_transactions] Processing ${remaining_updates.length} remaining outflow updates`);
            for (let i = 0; i < remaining_updates.length; i += BATCH_SIZE) {
                const batch = index_1.db.batch();
                const batch_updates = remaining_updates.slice(i, i + BATCH_SIZE);
                for (const update of batch_updates) {
                    const period_ref = index_1.db.collection('outflow_periods').doc(update.period_id);
                    batch.update(period_ref, {
                        transactionSplits: firestore_1.FieldValue.arrayUnion({
                            transactionId: update.transaction_split_ref.transaction_id,
                            splitId: update.transaction_split_ref.split_id,
                            amount: update.transaction_split_ref.amount,
                            paymentDate: update.transaction_split_ref.payment_date,
                        }),
                        status: 'paid',
                        updatedAt: firestore_1.Timestamp.now()
                    });
                }
                await batch.commit();
                console.log(`✅ [batch_create_transactions] Committed outflow updates batch ${Math.floor(i / BATCH_SIZE) + 1}`);
            }
        }
        console.log(`✅ [batch_create_transactions] Successfully created ${total_created} transactions with ${outflow_updates.length} outflow updates`);
        return total_created;
    }
    catch (error) {
        console.error('[batch_create_transactions] Error in batch creation:', error);
        throw error; // Throw to indicate failure
    }
}
//# sourceMappingURL=batch_create_transactions.js.map