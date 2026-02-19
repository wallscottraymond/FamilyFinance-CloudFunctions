"use strict";
/**
 * Align Transactions to Inflow Periods
 *
 * Matches Plaid transaction IDs to the correct inflow_period documents.
 * This is the core transaction matching logic for the income tracking system.
 *
 * Key Features:
 * - Matches transactions to ALL THREE period types (monthly, weekly, bi-weekly)
 * - Determines which occurrence each transaction satisfies
 * - Updates occurrence arrays (occurrencePaidFlags, occurrenceTransactionIds, occurrenceAmounts)
 * - Recalculates period totals and status
 *
 * NOTE: Plaid inflow transaction amounts are NEGATIVE (money coming IN).
 * We convert and store all amounts as POSITIVE values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.alignTransactionsToInflowPeriods = alignTransactionsToInflowPeriods;
exports.matchTransactionToInflowPeriod = matchTransactionToInflowPeriod;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const calculateInflowPeriodStatus_1 = require("./calculateInflowPeriodStatus");
/**
 * Find the best matching occurrence index for a transaction date
 *
 * Matches a transaction to the closest occurrence by date.
 * Prefers unpaid occurrences over already-paid ones.
 *
 * @param transactionDate - Date of the transaction
 * @param occurrenceDueDates - Array of due dates for occurrences
 * @param occurrencePaidFlags - Array of paid status for each occurrence
 * @returns Index of the best matching occurrence, or -1 if no match
 */
function findMatchingOccurrenceIndex(transactionDate, occurrenceDueDates, occurrencePaidFlags) {
    var _a, _b;
    if (!occurrenceDueDates || occurrenceDueDates.length === 0) {
        return -1;
    }
    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestUnpaidIndex = -1;
    let bestUnpaidDistance = Infinity;
    for (let i = 0; i < occurrenceDueDates.length; i++) {
        const dueDate = (_a = occurrenceDueDates[i]) === null || _a === void 0 ? void 0 : _a.toDate();
        if (!dueDate)
            continue;
        // Calculate distance (transaction can be before or after due date)
        const distance = Math.abs(transactionDate.getTime() - dueDate.getTime());
        // Track best overall match
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
        // Track best unpaid match (preferred)
        const isPaid = (_b = occurrencePaidFlags[i]) !== null && _b !== void 0 ? _b : false;
        if (!isPaid && distance < bestUnpaidDistance) {
            bestUnpaidDistance = distance;
            bestUnpaidIndex = i;
        }
    }
    // Prefer unpaid occurrence if within reasonable range (14 days)
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    if (bestUnpaidIndex !== -1 && bestUnpaidDistance <= fourteenDaysMs) {
        return bestUnpaidIndex;
    }
    // Otherwise return best overall match if within 30 days
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (bestIndex !== -1 && bestDistance <= thirtyDaysMs) {
        return bestIndex;
    }
    return -1;
}
/**
 * Find all matching inflow periods for a transaction date
 *
 * @param db - Firestore database instance
 * @param inflowId - The inflow ID
 * @param transactionDate - Date of the transaction
 * @param userId - User ID for ownership check
 * @returns Array of matching period documents
 */
async function findMatchingInflowPeriods(db, inflowId, transactionDate, userId) {
    const periods = [];
    // Query for all period types that contain the transaction date
    for (const periodType of [types_1.PeriodType.MONTHLY, types_1.PeriodType.WEEKLY, types_1.PeriodType.BI_MONTHLY]) {
        const query = await db
            .collection('inflow_periods')
            .where('inflowId', '==', inflowId)
            .where('ownerId', '==', userId)
            .where('periodType', '==', periodType)
            .where('periodStartDate', '<=', firestore_1.Timestamp.fromDate(transactionDate))
            .where('periodEndDate', '>=', firestore_1.Timestamp.fromDate(transactionDate))
            .limit(1)
            .get();
        if (!query.empty) {
            periods.push(query.docs[0]);
        }
    }
    return periods;
}
/**
 * Align transactions to inflow periods
 *
 * This is the main function that matches inflow transactions to their
 * corresponding inflow periods. It handles:
 * - Fetching transactions by Plaid transaction IDs
 * - Finding matching periods for each transaction
 * - Matching transactions to specific occurrences
 * - Updating occurrence arrays
 * - Recalculating period totals
 *
 * @param db - Firestore database instance
 * @param inflowId - The inflow document ID
 * @param inflow - The inflow document data
 * @param createdPeriodIds - Array of period IDs that were created (optional filter)
 * @returns AlignmentResult with statistics
 *
 * @example
 * ```typescript
 * // After creating inflow periods
 * const result = await alignTransactionsToInflowPeriods(
 *   db,
 *   'inflow_123',
 *   inflowData,
 *   ['period_1', 'period_2', 'period_3']
 * );
 * // Result: { transactionsProcessed: 5, transactionsMatched: 4, periodsUpdated: 6, errors: [] }
 * ```
 */
async function alignTransactionsToInflowPeriods(db, inflowId, inflow, createdPeriodIds) {
    var _a;
    const result = {
        transactionsProcessed: 0,
        transactionsMatched: 0,
        periodsUpdated: 0,
        errors: []
    };
    // Get transaction IDs from inflow
    const transactionIds = inflow.transactionIds || [];
    if (transactionIds.length === 0) {
        console.log(`[alignTransactionsToInflowPeriods] No transactions to align for inflow: ${inflowId}`);
        return result;
    }
    const userId = inflow.ownerId || inflow.userId;
    if (!userId) {
        result.errors.push('No userId found on inflow');
        return result;
    }
    console.log(`[alignTransactionsToInflowPeriods] Processing ${transactionIds.length} transactions for inflow: ${inflowId}`);
    // Fetch all transactions
    const transactions = [];
    // Batch fetch transactions (Firestore has a limit of 30 for 'in' queries)
    const batchSize = 30;
    for (let i = 0; i < transactionIds.length; i += batchSize) {
        const batch = transactionIds.slice(i, i + batchSize);
        try {
            const querySnapshot = await db
                .collection('transactions')
                .where('transactionId', 'in', batch)
                .get();
            querySnapshot.forEach((doc) => {
                var _a, _b;
                const data = doc.data();
                transactions.push({
                    id: doc.id,
                    transactionId: data.transactionId || doc.id,
                    amount: data.amount || 0,
                    date: ((_a = data.date) === null || _a === void 0 ? void 0 : _a.toDate()) || ((_b = data.dateTransacted) === null || _b === void 0 ? void 0 : _b.toDate()) || new Date(),
                    description: data.description || data.name,
                    merchantName: data.merchantName
                });
            });
        }
        catch (error) {
            result.errors.push(`Error fetching transactions batch: ${error}`);
        }
    }
    result.transactionsProcessed = transactions.length;
    // Group updates by period to batch them
    const periodUpdates = new Map();
    // Process each transaction
    for (const transaction of transactions) {
        const transactionDate = transaction.date instanceof Date
            ? transaction.date
            : transaction.date.toDate();
        // Find matching periods
        const matchingPeriods = await findMatchingInflowPeriods(db, inflowId, transactionDate, userId);
        if (matchingPeriods.length === 0) {
            console.log(`[alignTransactionsToInflowPeriods] No matching periods for transaction ${transaction.transactionId} on ${transactionDate.toISOString().split('T')[0]}`);
            continue;
        }
        result.transactionsMatched++;
        // Match to each period type
        for (const periodDoc of matchingPeriods) {
            const periodData = periodDoc.data();
            const periodId = periodDoc.id;
            // Skip if not in created periods filter (if provided)
            if (createdPeriodIds && !createdPeriodIds.includes(periodId)) {
                continue;
            }
            // Find matching occurrence
            const occurrenceIndex = findMatchingOccurrenceIndex(transactionDate, periodData.occurrenceDueDates || [], periodData.occurrencePaidFlags || []);
            if (occurrenceIndex === -1) {
                console.log(`[alignTransactionsToInflowPeriods] No matching occurrence for transaction ${transaction.transactionId} in period ${periodId}`);
                continue;
            }
            // Collect update for this period
            if (!periodUpdates.has(periodId)) {
                periodUpdates.set(periodId, []);
            }
            periodUpdates.get(periodId).push({
                periodId,
                occurrenceIndex,
                transactionId: transaction.transactionId || transaction.id,
                amount: Math.abs(transaction.amount), // Always positive for income
                transactionDate
            });
        }
    }
    // Apply updates to periods in batches
    const batch = db.batch();
    let batchCount = 0;
    const maxBatchSize = 500;
    for (const [periodId, updates] of periodUpdates) {
        try {
            // Fetch current period data
            const periodRef = db.collection('inflow_periods').doc(periodId);
            const periodDoc = await periodRef.get();
            if (!periodDoc.exists) {
                result.errors.push(`Period ${periodId} not found`);
                continue;
            }
            const periodData = periodDoc.data();
            // Clone arrays for modification
            const occurrencePaidFlags = [...(periodData.occurrencePaidFlags || [])];
            const occurrenceTransactionIds = [...(periodData.occurrenceTransactionIds || [])];
            const occurrenceAmounts = [...(periodData.occurrenceAmounts || [])];
            let transactionIdsArray = [...(periodData.transactionIds || [])];
            // Apply each update
            for (const update of updates) {
                const { occurrenceIndex, transactionId, amount } = update;
                // Ensure arrays are long enough
                while (occurrencePaidFlags.length <= occurrenceIndex) {
                    occurrencePaidFlags.push(false);
                }
                while (occurrenceTransactionIds.length <= occurrenceIndex) {
                    occurrenceTransactionIds.push(null);
                }
                while (occurrenceAmounts.length <= occurrenceIndex) {
                    occurrenceAmounts.push(0);
                }
                // Update occurrence
                occurrencePaidFlags[occurrenceIndex] = true;
                occurrenceTransactionIds[occurrenceIndex] = transactionId;
                occurrenceAmounts[occurrenceIndex] = amount;
                // Add to transaction IDs if not already present
                if (!transactionIdsArray.includes(transactionId)) {
                    transactionIdsArray.push(transactionId);
                }
            }
            // Calculate totals
            const numberOfOccurrencesPaid = occurrencePaidFlags.filter(Boolean).length;
            const totalAmountPaid = occurrenceAmounts.reduce((sum, amt) => sum + (amt || 0), 0);
            const totalAmountDue = periodData.totalAmountDue ||
                (periodData.numberOfOccurrencesInPeriod || 0) * (periodData.amountPerOccurrence || 0);
            const totalAmountUnpaid = Math.max(0, totalAmountDue - totalAmountPaid);
            // Determine payment status
            const isFullyPaid = numberOfOccurrencesPaid >= (periodData.numberOfOccurrencesInPeriod || 0);
            const isPartiallyPaid = numberOfOccurrencesPaid > 0 && !isFullyPaid;
            // Find next unpaid due date
            let nextUnpaidDueDate = null;
            for (let i = 0; i < occurrencePaidFlags.length; i++) {
                if (!occurrencePaidFlags[i] && ((_a = periodData.occurrenceDueDates) === null || _a === void 0 ? void 0 : _a[i])) {
                    nextUnpaidDueDate = periodData.occurrenceDueDates[i];
                    break;
                }
            }
            // Calculate progress percentages
            const paymentProgressPercentage = periodData.numberOfOccurrencesInPeriod
                ? Math.round((numberOfOccurrencesPaid / periodData.numberOfOccurrencesInPeriod) * 100)
                : 0;
            const dollarProgressPercentage = totalAmountDue > 0
                ? Math.round((totalAmountPaid / totalAmountDue) * 100)
                : 0;
            // Calculate status
            const status = (0, calculateInflowPeriodStatus_1.calculateInflowPeriodStatus)(Object.assign(Object.assign({}, periodData), { numberOfOccurrencesPaid,
                occurrencePaidFlags, occurrenceDueDates: periodData.occurrenceDueDates, nextUnpaidDueDate }));
            // Prepare update
            const updateData = {
                occurrencePaidFlags,
                occurrenceTransactionIds,
                occurrenceAmounts,
                transactionIds: transactionIdsArray,
                numberOfOccurrencesPaid,
                numberOfOccurrencesUnpaid: (periodData.numberOfOccurrencesInPeriod || 0) - numberOfOccurrencesPaid,
                totalAmountPaid,
                totalAmountUnpaid,
                isFullyPaid,
                isPartiallyPaid,
                isPaid: isFullyPaid,
                status, // Add the calculated status
                nextUnpaidDueDate,
                paymentProgressPercentage,
                dollarProgressPercentage,
                updatedAt: firestore_1.FieldValue.serverTimestamp()
            };
            batch.update(periodRef, updateData);
            batchCount++;
            result.periodsUpdated++;
            // Commit batch if approaching limit
            if (batchCount >= maxBatchSize) {
                await batch.commit();
                batchCount = 0;
            }
            console.log(`[alignTransactionsToInflowPeriods] Updated period ${periodId}: ` +
                `${numberOfOccurrencesPaid}/${periodData.numberOfOccurrencesInPeriod} occurrences paid, ` +
                `$${totalAmountPaid.toFixed(2)} received`);
        }
        catch (error) {
            result.errors.push(`Error updating period ${periodId}: ${error}`);
        }
    }
    // Commit any remaining updates
    if (batchCount > 0) {
        try {
            await batch.commit();
        }
        catch (error) {
            result.errors.push(`Error committing final batch: ${error}`);
        }
    }
    console.log(`[alignTransactionsToInflowPeriods] Complete: ` +
        `${result.transactionsProcessed} processed, ${result.transactionsMatched} matched, ` +
        `${result.periodsUpdated} periods updated, ${result.errors.length} errors`);
    return result;
}
/**
 * Update a single inflow period with a transaction match
 *
 * Simpler function for updating a single period when a transaction is manually assigned.
 *
 * @param db - Firestore database instance
 * @param periodId - The inflow period document ID
 * @param transaction - The transaction to match
 * @returns Success status and any error message
 */
async function matchTransactionToInflowPeriod(db, periodId, transaction) {
    try {
        const periodRef = db.collection('inflow_periods').doc(periodId);
        const periodDoc = await periodRef.get();
        if (!periodDoc.exists) {
            return { success: false, error: 'Period not found' };
        }
        const periodData = periodDoc.data();
        const transactionDate = transaction.date instanceof Date
            ? transaction.date
            : transaction.date.toDate();
        // Find matching occurrence
        const occurrenceIndex = findMatchingOccurrenceIndex(transactionDate, periodData.occurrenceDueDates || [], periodData.occurrencePaidFlags || []);
        if (occurrenceIndex === -1) {
            return { success: false, error: 'No matching occurrence found' };
        }
        // Clone arrays
        const occurrencePaidFlags = [...(periodData.occurrencePaidFlags || [])];
        const occurrenceTransactionIds = [...(periodData.occurrenceTransactionIds || [])];
        const occurrenceAmounts = [...(periodData.occurrenceAmounts || [])];
        // Ensure arrays are long enough
        while (occurrencePaidFlags.length <= occurrenceIndex) {
            occurrencePaidFlags.push(false);
        }
        while (occurrenceTransactionIds.length <= occurrenceIndex) {
            occurrenceTransactionIds.push(null);
        }
        while (occurrenceAmounts.length <= occurrenceIndex) {
            occurrenceAmounts.push(0);
        }
        // Update occurrence
        const transactionId = transaction.transactionId || transaction.id;
        const amount = Math.abs(transaction.amount);
        occurrencePaidFlags[occurrenceIndex] = true;
        occurrenceTransactionIds[occurrenceIndex] = transactionId;
        occurrenceAmounts[occurrenceIndex] = amount;
        // Calculate totals
        const numberOfOccurrencesPaid = occurrencePaidFlags.filter(Boolean).length;
        const totalAmountPaid = occurrenceAmounts.reduce((sum, amt) => sum + (amt || 0), 0);
        const totalAmountDue = periodData.totalAmountDue ||
            (periodData.numberOfOccurrencesInPeriod || 0) * (periodData.amountPerOccurrence || 0);
        const totalAmountUnpaid = Math.max(0, totalAmountDue - totalAmountPaid);
        const isFullyPaid = numberOfOccurrencesPaid >= (periodData.numberOfOccurrencesInPeriod || 0);
        const isPartiallyPaid = numberOfOccurrencesPaid > 0 && !isFullyPaid;
        // Add transaction ID to array
        const transactionIdsArray = [...(periodData.transactionIds || [])];
        if (!transactionIdsArray.includes(transactionId)) {
            transactionIdsArray.push(transactionId);
        }
        // Update period
        await periodRef.update({
            occurrencePaidFlags,
            occurrenceTransactionIds,
            occurrenceAmounts,
            transactionIds: transactionIdsArray,
            numberOfOccurrencesPaid,
            numberOfOccurrencesUnpaid: (periodData.numberOfOccurrencesInPeriod || 0) - numberOfOccurrencesPaid,
            totalAmountPaid,
            totalAmountUnpaid,
            isFullyPaid,
            isPartiallyPaid,
            isPaid: isFullyPaid,
            updatedAt: firestore_1.FieldValue.serverTimestamp()
        });
        return { success: true };
    }
    catch (error) {
        return { success: false, error: `${error}` };
    }
}
exports.default = alignTransactionsToInflowPeriods;
//# sourceMappingURL=alignTransactionsToInflowPeriods.js.map