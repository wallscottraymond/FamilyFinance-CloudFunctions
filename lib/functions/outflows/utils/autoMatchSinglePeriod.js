"use strict";
/**
 * Auto-Match Transactions to Single Outflow Period
 *
 * This utility matches historical transactions to a specific outflow period
 * when that period is created. Runs as part of the onOutflowPeriodCreate trigger.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoMatchSinglePeriod = autoMatchSinglePeriod;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
/**
 * Auto-match transactions to a single outflow period
 *
 * @param db - Firestore instance
 * @param periodId - The outflow period ID
 * @param period - The outflow period data
 * @param outflow - The parent outflow (flat structure)
 * @returns Result with match statistics
 */
async function autoMatchSinglePeriod(db, periodId, period, outflow) {
    const result = {
        success: false,
        transactionsMatched: 0,
        splitsAssigned: 0,
        periodUpdated: false,
        finalStatus: null,
        errors: []
    };
    try {
        console.log(`[autoMatchSinglePeriod] Matching transactions for period: ${periodId}`);
        console.log(`[autoMatchSinglePeriod] Period range: ${period.periodStartDate.toDate().toISOString()} to ${period.periodEndDate.toDate().toISOString()}`);
        // Step 1: Get transactions from the outflow's transactionIds (root level)
        const transactionIds = outflow.transactionIds || [];
        if (transactionIds.length === 0) {
            console.log(`[autoMatchSinglePeriod] No transactions to match (transactionIds empty)`);
            result.success = true;
            return result;
        }
        console.log(`[autoMatchSinglePeriod] Fetching ${transactionIds.length} transactions...`);
        const transactionPromises = transactionIds.map((txnId) => db.collection('transactions').doc(txnId).get());
        const transactionSnaps = await Promise.all(transactionPromises);
        const transactions = transactionSnaps
            .filter((snap) => snap.exists)
            .map((snap) => (Object.assign({ id: snap.id }, snap.data())));
        console.log(`[autoMatchSinglePeriod] Found ${transactions.length} existing transactions`);
        if (transactions.length === 0) {
            console.log(`[autoMatchSinglePeriod] No transactions found to match`);
            result.success = true;
            return result;
        }
        // Step 2: Filter transactions that fall within this period's date range
        const matchingTransactions = transactions.filter(txn => {
            const txnDate = txn.transactionDate; // Use transactionDate, not date
            const periodStart = period.periodStartDate;
            const periodEnd = period.periodEndDate;
            return txnDate >= periodStart && txnDate <= periodEnd;
        });
        console.log(`[autoMatchSinglePeriod] ${matchingTransactions.length} transactions fall within this period`);
        if (matchingTransactions.length === 0) {
            console.log(`[autoMatchSinglePeriod] No transactions match this period's date range`);
            result.success = true;
            return result;
        }
        // Step 3: Create transaction split references
        const splitReferences = [];
        for (const txn of matchingTransactions) {
            // Use the first split's amount (most transactions have single split)
            const firstSplit = txn.splits && txn.splits.length > 0 ? txn.splits[0] : null;
            if (!firstSplit) {
                console.log(`[autoMatchSinglePeriod] Skipping transaction ${txn.id} - no splits found`);
                continue;
            }
            const paymentType = determinePaymentType(txn, period, firstSplit.amount);
            const splitRef = {
                transactionId: txn.id,
                splitId: firstSplit.splitId || `${txn.id}_split_0`, // Use splitId field
                transactionDate: txn.transactionDate,
                amount: firstSplit.amount,
                description: txn.description || txn.merchantName || 'Unknown',
                paymentType: paymentType,
                isAutoMatched: true,
                matchedAt: firestore_1.Timestamp.now(),
                matchedBy: 'system'
            };
            splitReferences.push(splitRef);
            result.splitsAssigned++;
        }
        result.transactionsMatched = matchingTransactions.length;
        console.log(`[autoMatchSinglePeriod] Created ${splitReferences.length} split references`);
        // Step 4: Calculate new status based on splits
        const totalPaid = splitReferences.reduce((sum, split) => sum + split.amount, 0);
        const expectedAmount = period.expectedAmount || period.amountWithheld || 0;
        const newStatus = calculatePeriodStatus(period, splitReferences, totalPaid, expectedAmount);
        result.finalStatus = newStatus;
        console.log(`[autoMatchSinglePeriod] Calculated status: ${newStatus}`);
        console.log(`[autoMatchSinglePeriod] Total paid: $${totalPaid.toFixed(2)}, Expected: $${expectedAmount.toFixed(2)}`);
        // Step 5: Update the outflow period with split references, transaction IDs, and status
        const assignedTransactionIds = matchingTransactions.map(txn => txn.id);
        const periodRef = db.collection('outflow_periods').doc(periodId);
        await periodRef.update({
            // Transaction tracking arrays
            transactionIds: assignedTransactionIds,
            occurrenceTransactionIds: assignedTransactionIds,
            transactionSplits: splitReferences,
            // Status fields
            status: newStatus,
            isPaid: newStatus === types_1.OutflowPeriodStatus.PAID,
            isPartiallyPaid: newStatus === types_1.OutflowPeriodStatus.PARTIAL,
            isFullyPaid: newStatus === types_1.OutflowPeriodStatus.PAID,
            updatedAt: firestore_1.Timestamp.now()
        });
        result.periodUpdated = true;
        result.success = true;
        console.log(`[autoMatchSinglePeriod] ✓ Successfully updated period:`);
        console.log(`[autoMatchSinglePeriod]   - Transaction IDs: ${assignedTransactionIds.length}`);
        console.log(`[autoMatchSinglePeriod]   - Transaction Splits: ${splitReferences.length}`);
        console.log(`[autoMatchSinglePeriod]   - Status: ${newStatus}`);
    }
    catch (error) {
        console.error(`[autoMatchSinglePeriod] Error:`, error);
        result.errors.push(error.message || 'Unknown error');
    }
    return result;
}
/**
 * Determine payment type based on transaction and period
 */
function determinePaymentType(transaction, period, splitAmount) {
    const expectedAmount = period.expectedAmount || period.amountWithheld || 0;
    // Check if payment is significantly larger than expected (10% tolerance)
    if (splitAmount > expectedAmount * 1.1) {
        return types_1.PaymentType.EXTRA_PRINCIPAL;
    }
    // Check if this is a due period and payment date
    if (period.isDuePeriod && period.dueDate) {
        const dueDate = period.dueDate.toDate();
        const txnDate = transaction.transactionDate.toDate();
        const daysDiff = Math.floor((txnDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        // Payment made before due date
        if (daysDiff < -7) {
            return types_1.PaymentType.ADVANCE; // More than 7 days early
        }
        else if (daysDiff < 0) {
            return types_1.PaymentType.REGULAR; // Before due date but within 7 days
        }
        else if (daysDiff > 0) {
            return types_1.PaymentType.CATCH_UP; // After due date (late payment)
        }
    }
    return types_1.PaymentType.REGULAR;
}
/**
 * Calculate period status based on payments
 */
function calculatePeriodStatus(period, splits, totalPaid, expectedAmount) {
    // If not a due period, status is 'pending' (waiting for due date)
    if (!period.isDuePeriod) {
        return types_1.OutflowPeriodStatus.PENDING;
    }
    // No payments
    if (splits.length === 0 || totalPaid === 0) {
        // Check if overdue
        if (period.dueDate) {
            const now = new Date();
            const dueDate = period.dueDate.toDate();
            if (now > dueDate) {
                return types_1.OutflowPeriodStatus.OVERDUE;
            }
        }
        return types_1.OutflowPeriodStatus.PENDING;
    }
    // Has payments - check if fully paid
    if (totalPaid >= expectedAmount) {
        return types_1.OutflowPeriodStatus.PAID;
    }
    // Partial payment
    return types_1.OutflowPeriodStatus.PARTIAL;
}
//# sourceMappingURL=autoMatchSinglePeriod.js.map