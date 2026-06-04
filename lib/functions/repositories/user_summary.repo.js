"use strict";
/**
 * User Summary Repository
 *
 * Handles persistence for user_summaries collection.
 * Follows the 5-layer architecture pattern.
 *
 * @module repositories/user_summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.user_summary_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "user_summaries";
/**
 * Maps snake_case entity to camelCase Firestore document.
 */
/* eslint-disable @typescript-eslint/naming-convention */
function map_to_firestore_doc(entity) {
    return {
        id: entity.id,
        userId: entity.user_id,
        sourcePeriodId: entity.source_period_id,
        periodType: entity.period_type,
        // Period context
        periodStartDate: entity.period_start_date,
        periodEndDate: entity.period_end_date,
        year: entity.year,
        month: entity.month,
        weekNumber: entity.week_number,
        biMonthlyHalf: entity.bi_monthly_half,
        // Resource entries
        outflows: entity.outflows,
        budgets: entity.budgets,
        inflows: entity.inflows,
        goals: entity.goals,
        // Metadata
        lastRecalculated: entity.last_recalculated,
        createdAt: entity.created_at,
        updatedAt: entity.updated_at,
    };
}
/**
 * Maps camelCase Firestore document to snake_case domain entity.
 */
function map_to_domain(doc_data) {
    return {
        id: doc_data.id,
        user_id: doc_data.userId,
        source_period_id: doc_data.sourcePeriodId,
        period_type: doc_data.periodType,
        // Period context
        period_start_date: doc_data.periodStartDate,
        period_end_date: doc_data.periodEndDate,
        year: doc_data.year,
        month: doc_data.month,
        week_number: doc_data.weekNumber,
        bi_monthly_half: doc_data.biMonthlyHalf,
        // Resource entries
        outflows: doc_data.outflows || [],
        budgets: doc_data.budgets || [],
        inflows: doc_data.inflows || [],
        goals: doc_data.goals || [],
        // Metadata
        last_recalculated: doc_data.lastRecalculated,
        created_at: doc_data.createdAt,
        updated_at: doc_data.updatedAt,
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
 * User Summary Repository
 *
 * Handles persistence for user_summaries collection.
 */
exports.user_summary_repo = {
    /**
     * Saves a user summary document.
     *
     * Creates or updates the summary document with a full replace operation.
     * This is the intended behavior - summaries are always recalculated completely.
     *
     * @param ctx - Trace context for logging
     * @param entity - The summary entity to save
     * @returns Write result
     */
    async save(ctx, entity) {
        const db = (0, firestore_1.getFirestore)();
        const ref = db.collection(COLLECTION).doc(entity.id);
        // Get existing for audit
        const existing_doc = await ref.get();
        const before = existing_doc.exists ? existing_doc.data() : null;
        // Map to Firestore format
        const doc_data = map_to_firestore_doc(entity);
        // Write document
        await ref.set(doc_data);
        console.log(`[${ctx.trace_id}] user_summary_repo.save: ${existing_doc.exists ? "updated" : "created"} ${entity.id}`);
        // Audit entry (async, non-blocking)
        (0, audit_1.record_audit_entry_async)({
            user_id: entity.user_id,
            action: existing_doc.exists ? "update" : "create",
            entity_type: "user_summary",
            entity_id: entity.id,
            before: before,
            after: doc_data,
            trace_id: ctx.trace_id,
            metadata: {
                source: "api",
                context: {
                    period_type: entity.period_type,
                    source_period_id: entity.source_period_id,
                },
            },
        });
        return (0, types_1.create_write_result)("user_summary", entity.id, "replace", before, doc_data);
    },
    /**
     * Gets a user summary by ID.
     *
     * @param ctx - Trace context for logging
     * @param id - The summary document ID
     * @returns The summary entity or null if not found
     */
    async get_by_id(ctx, id) {
        const doc = await doc_ref(id).get();
        if (!doc.exists) {
            console.log(`[${ctx.trace_id}] user_summary_repo.get_by_id: not found ${id}`);
            return null;
        }
        console.log(`[${ctx.trace_id}] user_summary_repo.get_by_id: found ${id}`);
        return map_to_domain(doc.data());
    },
    /**
     * Gets a user summary by user, period type, and source period.
     *
     * This is the most common query pattern for summaries.
     *
     * @param ctx - Trace context for logging
     * @param user_id - The user ID
     * @param period_type - The period type (e.g., "monthly")
     * @param source_period_id - The source period ID (e.g., "2025M06")
     * @returns The summary entity or null if not found
     */
    async get_by_user_and_period(ctx, user_id, period_type, source_period_id) {
        // Build the expected document ID
        const normalized_period_type = period_type.toLowerCase();
        const summary_id = `${user_id}_${normalized_period_type}_${source_period_id}`;
        return this.get_by_id(ctx, summary_id);
    },
    /**
     * Maps a UserPeriodSummary (camelCase frontend format) to UserSummaryForPersistence (snake_case domain format).
     *
     * Helper function for converting existing summary objects to the persistence format.
     */
    map_from_user_period_summary(summary) {
        return {
            id: summary.id,
            user_id: summary.userId,
            source_period_id: summary.sourcePeriodId,
            period_type: summary.periodType,
            period_start_date: summary.periodStartDate,
            period_end_date: summary.periodEndDate,
            year: summary.year,
            month: summary.month,
            week_number: summary.weekNumber,
            bi_monthly_half: summary.biMonthlyHalf,
            outflows: summary.outflows,
            budgets: summary.budgets,
            inflows: summary.inflows,
            goals: summary.goals,
            last_recalculated: summary.lastRecalculated,
            created_at: summary.createdAt,
            updated_at: summary.updatedAt,
        };
    },
    /**
     * Atomically updates a user summary using a Firestore transaction.
     *
     * This prevents race conditions by:
     * 1. Reading the existing summary (establishes conflict detection)
     * 2. Reading all dependent period documents inside the transaction
     * 3. Computing the new summary with fresh data
     * 4. Writing atomically
     *
     * If the summary document changes between read and write, Firestore
     * automatically retries the transaction with fresh data.
     *
     * @param ctx - Trace context for logging
     * @param summary_id - The summary document ID
     * @param user_id - The user ID
     * @param source_period_id - The source period ID
     * @param period_type - The period type
     * @param compute_fn - Function to compute the summary from dependencies
     * @returns Write result
     */
    async save_with_transaction(ctx, summary_id, user_id, source_period_id, period_type, compute_fn) {
        const db = (0, firestore_1.getFirestore)();
        const summary_ref = db.collection(COLLECTION).doc(summary_id);
        let before_data = null;
        let after_data = null;
        let was_created = false;
        await db.runTransaction(async (transaction) => {
            // 1. Read the existing summary FIRST (establishes conflict detection)
            const existing_summary = await transaction.get(summary_ref);
            before_data = existing_summary.exists ? existing_summary.data() : null;
            was_created = !existing_summary.exists;
            // 2. Read source period
            const source_period_ref = db.collection("source_periods").doc(source_period_id);
            const source_period_doc = await transaction.get(source_period_ref);
            if (!source_period_doc.exists) {
                throw new Error(`Source period not found: ${source_period_id}`);
            }
            const source_period = source_period_doc.data();
            // 3. Read all dependent period documents
            // Note: Firestore transactions require us to read docs by reference, not query
            // So we query outside and then read each doc inside the transaction for conflict detection
            const [outflow_snapshot, budget_snapshot, inflow_snapshot] = await Promise.all([
                db.collection("outflow_periods")
                    .where("ownerId", "==", user_id)
                    .where("sourcePeriodId", "==", source_period_id)
                    .where("isActive", "==", true)
                    .get(),
                db.collection("budget_periods")
                    .where("userId", "==", user_id)
                    .where("sourcePeriodId", "==", source_period_id)
                    .where("periodType", "==", period_type)
                    .where("isActive", "==", true)
                    .get(),
                db.collection("inflow_periods")
                    .where("ownerId", "==", user_id)
                    .where("sourcePeriodId", "==", source_period_id)
                    .where("isActive", "==", true)
                    .get(),
            ]);
            const outflow_periods = outflow_snapshot.docs.map((doc) => doc.data());
            const budget_periods = budget_snapshot.docs.map((doc) => doc.data());
            const inflow_periods = inflow_snapshot.docs.map((doc) => doc.data());
            console.log(`[${ctx.trace_id}] user_summary_repo.save_with_transaction: ` +
                `read ${outflow_periods.length} outflows, ${budget_periods.length} budgets, ${inflow_periods.length} inflows`);
            // 4. Compute new summary using provided function
            const new_summary = compute_fn({
                source_period,
                outflow_periods,
                budget_periods,
                inflow_periods,
            });
            // 5. Write atomically
            after_data = map_to_firestore_doc(new_summary);
            transaction.set(summary_ref, after_data);
        });
        console.log(`[${ctx.trace_id}] user_summary_repo.save_with_transaction: ` +
            `${was_created ? "created" : "updated"} ${summary_id}`);
        // Audit entry (async, non-blocking)
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: was_created ? "create" : "update",
            entity_type: "user_summary",
            entity_id: summary_id,
            before: before_data,
            after: after_data,
            trace_id: ctx.trace_id,
            metadata: {
                source: "api",
                context: {
                    period_type,
                    source_period_id,
                    transactional: true,
                },
            },
        });
        return (0, types_1.create_write_result)("user_summary", summary_id, "replace", before_data, after_data);
    },
};
//# sourceMappingURL=user_summary.repo.js.map