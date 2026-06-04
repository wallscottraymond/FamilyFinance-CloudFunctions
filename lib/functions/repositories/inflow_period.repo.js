"use strict";
/**
 * Inflow Period Repository
 *
 * Handles persistence for inflow_periods collection.
 * Creates period-specific instances of recurring inflows.
 *
 * @module repositories/inflow_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inflow_period_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "inflow_periods";
/**
 * Maps snake_case entity to camelCase Firestore document.
 */
/* eslint-disable @typescript-eslint/naming-convention */
function map_to_firestore_doc(entity) {
    return {
        id: entity.id,
        inflowId: entity.inflow_id,
        sourcePeriodId: entity.source_period_id,
        periodId: entity.source_period_id, // Alias for frontend compatibility
        // Ownership
        ownerId: entity.owner_id,
        userId: entity.owner_id, // Alias for frontend compatibility
        createdBy: entity.created_by,
        updatedBy: entity.updated_by,
        groupId: entity.group_id,
        groupIds: entity.group_ids,
        // Plaid identifiers
        accountId: entity.account_id,
        plaidItemId: entity.plaid_item_id,
        // Financial tracking
        actualAmount: entity.actual_amount,
        amountAllocated: entity.amount_allocated,
        amountWithheld: entity.amount_withheld,
        averageAmount: entity.average_amount,
        expectedAmount: entity.expected_amount,
        amountPerOccurrence: entity.amount_per_occurrence,
        totalAmountDue: entity.total_amount_due,
        totalAmountPaid: entity.total_amount_paid,
        totalAmountUnpaid: entity.total_amount_unpaid,
        // Timestamps
        createdAt: entity.created_at,
        updatedAt: entity.updated_at,
        lastCalculated: entity.last_calculated,
        // Payment cycle info
        currency: entity.currency,
        cycleDays: entity.cycle_days,
        cycleStartDate: entity.cycle_start_date,
        cycleEndDate: entity.cycle_end_date,
        dailyWithholdingRate: entity.daily_withholding_rate,
        // Inflow metadata
        description: entity.description,
        frequency: entity.frequency,
        incomeType: entity.income_type,
        // Payment status
        isPaid: entity.is_paid,
        isFullyPaid: entity.is_fully_paid,
        isPartiallyPaid: entity.is_partially_paid,
        isReceiptPeriod: entity.is_receipt_period,
        // Categorization
        internalDetailedCategory: entity.internal_detailed_category,
        internalPrimaryCategory: entity.internal_primary_category,
        plaidPrimaryCategory: entity.plaid_primary_category,
        plaidDetailedCategory: entity.plaid_detailed_category,
        // Status & control
        isActive: entity.is_active,
        isHidden: entity.is_hidden,
        // Merchant info
        merchant: entity.merchant,
        payee: entity.payee,
        // Period context
        periodStartDate: entity.period_start_date,
        periodEndDate: entity.period_end_date,
        periodType: entity.period_type,
        // Prediction
        predictedNextDate: entity.predicted_next_date,
        // User interaction
        rules: entity.rules,
        tags: entity.tags,
        type: entity.type,
        note: entity.note,
        userCustomName: entity.user_custom_name,
        // Source
        source: entity.source,
        // Transaction tracking
        transactionIds: entity.transaction_ids,
        // Multi-occurrence tracking
        numberOfOccurrencesInPeriod: entity.number_of_occurrences_in_period,
        numberOfOccurrencesPaid: entity.number_of_occurrences_paid,
        numberOfOccurrencesUnpaid: entity.number_of_occurrences_unpaid,
        occurrenceDueDates: entity.occurrence_due_dates,
        occurrencePaidFlags: entity.occurrence_paid_flags,
        occurrenceTransactionIds: entity.occurrence_transaction_ids,
        occurrenceAmounts: entity.occurrence_amounts,
        // Progress metrics
        paymentProgressPercentage: entity.payment_progress_percentage,
        dollarProgressPercentage: entity.dollar_progress_percentage,
        // Due date tracking
        firstDueDateInPeriod: entity.first_due_date_in_period,
        lastDueDateInPeriod: entity.last_due_date_in_period,
        nextUnpaidDueDate: entity.next_unpaid_due_date,
    };
}
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * Gets Firestore document reference.
 */
function doc_ref(id) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
}
/**
 * Inflow Period Repository
 *
 * All write operations automatically create audit entries.
 */
exports.inflow_period_repo = {
    /**
     * Saves a batch of inflow periods.
     *
     * Creates new inflow period documents for a recurring inflow.
     * Called when a new inflow is created or when periods need to be extended.
     */
    async save_batch(ctx, entities, user_id) {
        if (entities.length === 0) {
            return { results: [], count: 0, success: true };
        }
        const db = (0, firestore_1.getFirestore)();
        const results = [];
        // Process in batches to respect Firestore limits
        const chunks = (0, types_1.chunk_for_batch)(entities);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const entity of chunk) {
                const doc_data = map_to_firestore_doc(entity);
                batch.set(doc_ref(entity.id), doc_data);
                results.push((0, types_1.create_write_result)("inflow_period", entity.id, "replace", null, doc_data));
                // Audit entry (async, non-blocking)
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "create",
                    entity_type: "inflow_period",
                    entity_id: entity.id,
                    before: null,
                    after: doc_data,
                    trace_id: ctx.trace_id,
                    metadata: {
                        source: "api",
                        context: { inflow_id: entity.inflow_id },
                    },
                });
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] inflow_period_repo.save_batch: saved=${results.length}`);
        return {
            results,
            count: entities.length,
            success: true,
        };
    },
    /**
     * Gets inflow periods by inflow ID.
     */
    async get_by_inflow_id(ctx, inflow_id) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("inflowId", "==", inflow_id)
            .select() // Only need IDs
            .get();
        console.log(`[${ctx.trace_id}] inflow_period_repo.get_by_inflow_id: found=${snapshot.size}`);
        return snapshot.docs.map((doc) => doc.id);
    },
    /**
     * Gets the raw doc data + id for a set of period IDs (missing docs skipped).
     * READ-ONLY — used by the summary resolver to group periods for recompute.
     */
    async get_by_ids(_ctx, period_ids) {
        const docs = await Promise.all(period_ids.map((id) => (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id).get()));
        return docs
            .filter((doc) => doc.exists)
            .map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    /**
     * Deletes all inflow periods for an inflow.
     *
     * Used when regenerating periods or soft-deleting an inflow.
     */
    async delete_by_inflow_id(ctx, inflow_id, user_id) {
        const db = (0, firestore_1.getFirestore)();
        const results = [];
        // Get all periods for this inflow
        const snapshot = await db
            .collection(COLLECTION)
            .where("inflowId", "==", inflow_id)
            .get();
        if (snapshot.empty) {
            return results;
        }
        const chunks = (0, types_1.chunk_for_batch)(snapshot.docs);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const doc of chunk) {
                batch.delete(doc.ref);
                results.push((0, types_1.create_write_result)("inflow_period", doc.id, "replace", doc.data(), null));
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "delete",
                    entity_type: "inflow_period",
                    entity_id: doc.id,
                    before: doc.data(),
                    after: null,
                    trace_id: ctx.trace_id,
                    metadata: {
                        source: "api",
                        context: { inflow_id },
                    },
                });
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] inflow_period_repo.delete_by_inflow_id: deleted=${results.length}`);
        return results;
    },
};
//# sourceMappingURL=inflow_period.repo.js.map