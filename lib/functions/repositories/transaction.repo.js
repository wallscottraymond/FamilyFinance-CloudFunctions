"use strict";
/**
 * Transaction Repository
 *
 * Handles persistence for transaction entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/transaction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transaction_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "transactions";
/* eslint-enable @typescript-eslint/naming-convention */
// ============================================================================
// Mapping Functions
// ============================================================================
/**
 * Maps legacy Firestore document to PendingTransactionInfo.
 */
function map_to_pending_info(doc) {
    var _a, _b, _c, _d, _e, _f;
    return {
        doc_id: doc.id,
        plaid_transaction_id: doc.transactionId,
        amount: (_d = (_a = doc.amount) !== null && _a !== void 0 ? _a : (_c = (_b = doc.splits) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : 0,
        splits: (doc.splits || []).map(s => ({
            split_id: s.splitId,
            amount: s.amount,
            budget_id: s.budgetId,
            outflow_id: s.outflowId || null,
            internal_primary_category: s.internalPrimaryCategory,
            internal_detailed_category: s.internalDetailedCategory,
            is_default: s.isDefault,
            tags: s.tags || [],
        })),
        internal_primary_category: doc.internalPrimaryCategory,
        internal_detailed_category: doc.internalDetailedCategory,
        description_override: doc.description !== doc.name ? doc.description : null,
        tags: ((_f = (_e = doc.splits) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.tags) || [],
    };
}
/**
 * Maps TransactionForPersistence to legacy Firestore document.
 */
function map_to_doc(entity, now) {
    const group_ids = entity.group_ids || [];
    return {
        id: entity.id || "",
        transactionId: entity.transaction_id,
        userId: entity.user_id,
        ownerId: entity.user_id,
        groupId: group_ids[0] || null,
        groupIds: group_ids,
        isPrivate: group_ids.length === 0,
        transactionDate: firestore_1.Timestamp.fromDate(entity.transaction_date),
        accountId: entity.account_id,
        createdBy: entity.user_id,
        updatedBy: entity.user_id,
        currency: entity.currency,
        description: entity.name,
        internalDetailedCategory: entity.internal_detailed_category,
        internalPrimaryCategory: entity.internal_primary_category,
        plaidDetailedCategory: entity.plaid_detailed_category,
        plaidPrimaryCategory: entity.plaid_primary_category,
        plaidItemId: entity.plaid_item_id,
        source: entity.source,
        transactionStatus: entity.is_pending ? "pending" : "approved",
        type: entity.type,
        name: entity.name,
        merchantName: entity.merchant_name,
        amount: entity.amount,
        isPending: entity.is_pending,
        pendingTransactionId: entity.pending_transaction_id,
        splits: entity.splits.map(s => map_split_to_doc(s, now)),
        initialPlaidData: {
            plaidAccountId: entity.initial_plaid_data.plaid_account_id,
            plaidMerchantName: entity.initial_plaid_data.plaid_merchant_name,
            plaidName: entity.initial_plaid_data.plaid_name,
            plaidTransactionId: entity.initial_plaid_data.plaid_transaction_id,
            plaidPending: entity.initial_plaid_data.plaid_pending,
            source: "plaid",
        },
        createdAt: now,
        updatedAt: now,
        isActive: entity.is_active,
        isDeleted: !entity.is_active,
    };
}
function map_split_to_doc(split, now) {
    return {
        splitId: split.split_id,
        budgetId: split.budget_id,
        monthlyPeriodId: split.monthly_period_id,
        weeklyPeriodId: split.weekly_period_id,
        biWeeklyPeriodId: split.bi_weekly_period_id,
        outflowId: split.outflow_id,
        plaidPrimaryCategory: split.plaid_primary_category,
        plaidDetailedCategory: split.plaid_detailed_category,
        internalPrimaryCategory: split.internal_primary_category,
        internalDetailedCategory: split.internal_detailed_category,
        amount: split.amount,
        isDefault: split.is_default,
        isIgnored: split.is_ignored,
        isRefund: split.is_refund,
        isTaxDeductible: split.is_tax_deductible,
        paymentDate: firestore_1.Timestamp.fromDate(split.payment_date),
        rules: split.rules,
        tags: split.tags,
        createdAt: now,
        updatedAt: now,
    };
}
// ============================================================================
// Repository Functions
// ============================================================================
/**
 * Gets Firestore document reference.
 */
function doc_ref(id) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
}
/**
 * Transaction Repository
 *
 * All write operations automatically create audit entries.
 */
exports.transaction_repo = {
    /**
     * Upserts transactions from Plaid sync.
     *
     * For each transaction:
     * - If exists (by plaidTransactionId): updates if materially changed
     * - If new: creates with full data
     *
     * @param ctx - Trace context
     * @param transactions - Transactions ready for persistence
     * @param user_id - User ID
     * @param plaid_item_id - Plaid item ID (for scoping)
     * @returns Upsert results with created/updated counts
     */
    async upsert_from_plaid_sync(ctx, transactions, user_id, plaid_item_id) {
        if (transactions.length === 0) {
            return { created: 0, updated: 0, results: [] };
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        let created = 0;
        let updated = 0;
        const results = [];
        // Process in batches
        const chunks = (0, types_1.chunk_for_batch)(transactions);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const txn of chunk) {
                // Check if transaction exists
                const existing = await this.get_by_plaid_transaction_id(ctx, user_id, txn.transaction_id);
                if (existing) {
                    // UPDATE: Update the existing document
                    const doc_data = map_to_doc(Object.assign(Object.assign({}, txn), { id: existing.doc_id }), now);
                    doc_data.createdAt = existing.created_at; // Preserve original creation time
                    doc_data.updatedAt = now;
                    batch.update(doc_ref(existing.doc_id), doc_data);
                    results.push({
                        plaid_transaction_id: txn.transaction_id,
                        doc_id: existing.doc_id,
                        action: "updated",
                    });
                    updated++;
                    // Audit entry
                    (0, audit_1.record_audit_entry_async)({
                        user_id,
                        action: "update",
                        entity_type: "transaction",
                        entity_id: existing.doc_id,
                        before: { plaid_transaction_id: txn.transaction_id },
                        after: doc_data,
                        trace_id: ctx.trace_id,
                        metadata: { source: "api", context: { plaid_sync: true } },
                    });
                }
                else {
                    // CREATE: New transaction
                    const doc_id = db.collection(COLLECTION).doc().id;
                    const doc_data = map_to_doc(Object.assign(Object.assign({}, txn), { id: doc_id }), now);
                    batch.set(doc_ref(doc_id), doc_data);
                    results.push({
                        plaid_transaction_id: txn.transaction_id,
                        doc_id,
                        action: "created",
                    });
                    created++;
                    // Audit entry
                    (0, audit_1.record_audit_entry_async)({
                        user_id,
                        action: "create",
                        entity_type: "transaction",
                        entity_id: doc_id,
                        before: null,
                        after: doc_data,
                        trace_id: ctx.trace_id,
                        metadata: { source: "api", context: { plaid_sync: true } },
                    });
                }
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] upsert_from_plaid_sync: created=${created}, updated=${updated}`);
        return { created, updated, results };
    },
    /**
     * Loads full transaction docs by their PLAID transaction ids (the membership
     * list a recurring outflow/inflow carries in `transactionIds`). Queries by
     * `transactionId` (globally unique → no composite index) and filters to the
     * owner in memory. Batched via Firestore `in` (≤30 per query). Used by the
     * recurring reconciliation resolver.
     */
    async get_by_plaid_transaction_ids(ctx, user_id, plaid_transaction_ids) {
        if (plaid_transaction_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const out = [];
        for (let i = 0; i < plaid_transaction_ids.length; i += 30) {
            const chunk = plaid_transaction_ids.slice(i, i + 30);
            const snapshot = await db
                .collection(COLLECTION)
                .where("transactionId", "in", chunk)
                .get();
            for (const doc of snapshot.docs) {
                const data = doc.data();
                if (data.ownerId === user_id) {
                    out.push(data);
                }
            }
        }
        console.log(`[${ctx.trace_id}] get_by_plaid_transaction_ids: requested=${plaid_transaction_ids.length}, found=${out.length}`);
        return out;
    },
    /**
     * Updates specific fields on a transaction.
     *
     * @param ctx - Trace context
     * @param doc_id - Document ID
     * @param updates - Field updates to apply
     * @returns Write result
     */
    async update_transaction_fields(ctx, doc_id, updates) {
        const now = firestore_1.Timestamp.now();
        const before_doc = await doc_ref(doc_id).get();
        if (!before_doc.exists) {
            throw new Error(`Transaction ${doc_id} not found`);
        }
        const before = before_doc.data();
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
            updatedAt: now,
        };
        if (updates.internal_primary_category !== undefined) {
            update_data.internalPrimaryCategory = updates.internal_primary_category;
        }
        if (updates.internal_detailed_category !== undefined) {
            update_data.internalDetailedCategory = updates.internal_detailed_category;
        }
        if (updates.splits !== undefined) {
            update_data.splits = updates.splits.map(s => map_split_to_doc(s, now));
        }
        if (updates.is_pending !== undefined) {
            update_data.isPending = updates.is_pending;
            update_data.transactionStatus = updates.is_pending ? "pending" : "approved";
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(doc_id).update(update_data);
        // Audit entry
        (0, audit_1.record_audit_entry_async)({
            user_id: before.ownerId,
            action: "update",
            entity_type: "transaction",
            entity_id: doc_id,
            before: before,
            after: Object.assign(Object.assign({}, before), update_data),
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { plaid_sync: true, field_update: true } },
        });
        return (0, types_1.create_write_result)("transaction", doc_id, "merge", before, Object.assign(Object.assign({}, before), update_data));
    },
    /**
     * Soft-deletes transactions by Plaid transaction IDs.
     *
     * @param ctx - Trace context
     * @param user_id - User ID for verification
     * @param plaid_transaction_ids - Plaid transaction IDs to soft-delete
     * @param reason - Reason for deletion
     * @returns Write results
     */
    async soft_delete_by_plaid_ids(ctx, user_id, plaid_transaction_ids, reason) {
        if (plaid_transaction_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        // Query for all transactions by Plaid IDs
        const chunks = (0, types_1.chunk_for_batch)(plaid_transaction_ids);
        for (const chunk of chunks) {
            const snapshot = await db
                .collection(COLLECTION)
                .where("transactionId", "in", chunk)
                .where("ownerId", "==", user_id)
                .get();
            if (snapshot.empty)
                continue;
            const batch = db.batch();
            for (const doc of snapshot.docs) {
                const before = doc.data();
                /* eslint-disable @typescript-eslint/naming-convention */
                const update_data = {
                    isActive: false,
                    isDeleted: true,
                    deletionReason: reason,
                    updatedAt: now,
                };
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(doc.ref, update_data);
                results.push((0, types_1.create_write_result)("transaction", doc.id, "merge", before, Object.assign(Object.assign({}, before), update_data)));
                // Audit entry
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "delete",
                    entity_type: "transaction",
                    entity_id: doc.id,
                    before: before,
                    after: Object.assign(Object.assign({}, before), update_data),
                    trace_id: ctx.trace_id,
                    metadata: { source: "api", context: { plaid_sync: true, reason } },
                });
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] soft_delete_by_plaid_ids: deleted=${results.length}`);
        return results;
    },
    /**
     * Gets pending transactions for a Plaid item.
     *
     * Used by resolver to build the pending transaction lookup map
     * for pending->posted migration.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param plaid_item_id - Plaid item ID
     * @returns Map of plaid_transaction_id -> PendingTransactionInfo
     */
    async get_pending_transactions_for_item(ctx, user_id, plaid_item_id) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("ownerId", "==", user_id)
            .where("plaidItemId", "==", plaid_item_id)
            .where("isPending", "==", true)
            .where("isActive", "==", true)
            .get();
        const result = new Map();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            result.set(data.transactionId, map_to_pending_info(data));
        }
        console.log(`[${ctx.trace_id}] get_pending_transactions_for_item: found=${result.size}`);
        return result;
    },
    /**
     * Gets a transaction by Plaid transaction ID.
     *
     * @param ctx - Trace context
     * @param user_id - User ID for scoping
     * @param plaid_transaction_id - Plaid transaction ID
     * @returns Transaction info or null if not found
     */
    async get_by_plaid_transaction_id(ctx, user_id, plaid_transaction_id) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("transactionId", "==", plaid_transaction_id)
            .where("ownerId", "==", user_id)
            .limit(1)
            .get();
        if (snapshot.empty) {
            return null;
        }
        const doc = snapshot.docs[0];
        const data = doc.data();
        return {
            doc_id: doc.id,
            created_at: data.createdAt,
        };
    },
    /**
     * Gets transaction by document ID.
     *
     * @param ctx - Trace context
     * @param doc_id - Document ID
     * @returns Transaction document or null
     */
    async get_by_id(ctx, doc_id) {
        const doc = await doc_ref(doc_id).get();
        if (!doc.exists) {
            return null;
        }
        return doc.data();
    },
    /**
     * Writes the Transaction Assignment Engine's output: the updated splits array
     * (with the engine-owned assignment fields applied) plus the denormalized
     * `splitBudgetIds`. This is the engine's SINGLE write of split assignment.
     *
     * @param _ctx - Trace context
     * @param doc_id - Transaction document ID
     * @param updated_splits - The full splits array, with assignment fields applied
     * @param split_budget_ids - Distinct budget ids across the splits (queryable)
     */
    async apply_split_assignments(_ctx, doc_id, updated_splits, split_budget_ids) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(doc_id).update({
            splits: updated_splits,
            splitBudgetIds: split_budget_ids,
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Counts active transactions for a specific account.
     *
     * Used by resolvers to determine cascade scope for account removal.
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param user_id - User ID for scoping
     * @returns Count of active transactions for the account
     */
    async count_by_account_id(ctx, account_id, user_id) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("accountId", "==", account_id)
            .where("ownerId", "==", user_id)
            .where("isActive", "==", true)
            .count()
            .get();
        const count = snapshot.data().count;
        console.log(`[${ctx.trace_id}] count_by_account_id: account=${account_id}, count=${count}`);
        return count;
    },
    /**
     * Gets transaction IDs for a specific account.
     *
     * Used by resolvers to get affected transaction IDs for cascade operations.
     * Returns only IDs to minimize memory usage.
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param user_id - User ID for scoping
     * @param limit - Maximum number of IDs to return (default 1000)
     * @param options - Read options. `include_deleted: true` drops the
     *   `isActive == true` filter so soft-deleted/hidden transactions are
     *   returned too (needed by the account-restore flow, which must find the
     *   transactions that account removal set to `isActive: false`).
     * @returns Array of transaction document IDs
     */
    async get_ids_by_account_id(ctx, account_id, user_id, limit = 1000, options) {
        const db = (0, firestore_1.getFirestore)();
        let query = db
            .collection(COLLECTION)
            .where("accountId", "==", account_id)
            .where("ownerId", "==", user_id);
        if (!(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query
            .select() // Select no fields, just get document IDs
            .limit(limit)
            .get();
        const ids = snapshot.docs.map(doc => doc.id);
        console.log(`[${ctx.trace_id}] get_ids_by_account_id: account=${account_id}, found=${ids.length}`);
        return ids;
    },
    /**
     * Hides up to 500 active transactions for a removed account (one page). The
     * caller decides `exclude_from_budgets` (a removal-mode choice); the repo only
     * persists the computed hide fields. Idempotent. Returns the count hidden and
     * whether a full page came back (more may remain).
     */
    async hide_for_account(ctx, account_id, user_id, exclude_from_budgets) {
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const snapshot = await db
            .collection(COLLECTION)
            .where("accountId", "==", account_id)
            .where("ownerId", "==", user_id)
            .where("isActive", "==", true)
            .limit(500)
            .get();
        if (snapshot.empty) {
            return { hidden: 0, has_more: false };
        }
        let hidden = 0;
        const chunks = (0, types_1.chunk_for_batch)(snapshot.docs.map((d) => d.id));
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const id of chunk) {
                /* eslint-disable @typescript-eslint/naming-convention */
                const update_data = {
                    isActive: false,
                    isHidden: true,
                    hiddenAt: now,
                    hiddenReason: "account_removed",
                    updatedAt: now,
                };
                if (exclude_from_budgets) {
                    update_data.excludeFromBudgets = true;
                }
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(doc_ref(id), update_data);
                hidden++;
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] hide_for_account: account=${account_id}, hidden=${hidden}`);
        return { hidden, has_more: snapshot.size === 500 };
    },
    /**
     * Batch-applies a fixed set of fields to the given transaction IDs (chunked).
     * Generic persistence helper — no business logic; the caller computes `fields`.
     * Returns the number of docs written.
     */
    async set_fields_by_ids(ctx, ids, fields) {
        if (ids.length === 0) {
            return 0;
        }
        const db = (0, firestore_1.getFirestore)();
        let written = 0;
        for (const chunk of (0, types_1.chunk_for_batch)(ids)) {
            const batch = db.batch();
            for (const id of chunk) {
                batch.update(doc_ref(id), fields);
                written++;
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] set_fields_by_ids: written=${written}`);
        return written;
    },
    /**
     * Gets all active transaction IDs owned by a user.
     *
     * Queries by `userId` (the field the assignment engine + spend recompute use,
     * NOT `ownerId`) so the backfill's work-list matches exactly what
     * `recompute_budget_spent` will sum. Returns only IDs to bound memory.
     *
     * @param ctx - Trace context
     * @param user_id - User ID (matches the `userId` field)
     * @param limit - Maximum number of IDs to return (default 5000)
     * @returns Array of transaction document IDs
     */
    async get_ids_by_user_id(ctx, user_id, limit = 5000) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .where("isActive", "==", true)
            .select() // Document IDs only
            .limit(limit)
            .get();
        const ids = snapshot.docs.map((doc) => doc.id);
        console.log(`[${ctx.trace_id}] get_ids_by_user_id: user=${user_id}, found=${ids.length}`);
        return ids;
    },
    /**
     * Gets active transaction IDs that have at least one split assigned to a
     * budget. Splits are nested maps, so this scans the user's active
     * transactions (by ownerId AND userId, deduped) and filters in memory.
     * Used by the delete cascade to re-run assignment on a deleted budget's txns.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param budget_id - Budget whose referencing transactions to find
     */
    async get_ids_referencing_budget(ctx, user_id, budget_id) {
        const db = (0, firestore_1.getFirestore)();
        const [owner_snap, user_snap] = await Promise.all([
            db
                .collection(COLLECTION)
                .where("ownerId", "==", user_id)
                .where("isActive", "==", true)
                .get(),
            db
                .collection(COLLECTION)
                .where("userId", "==", user_id)
                .where("isActive", "==", true)
                .get(),
        ]);
        const matched = new Set();
        for (const snap of [owner_snap, user_snap]) {
            snap.docs.forEach((doc) => {
                var _a;
                /* eslint-disable @typescript-eslint/naming-convention */
                const splits = ((_a = doc.data().splits) !== null && _a !== void 0 ? _a : []);
                /* eslint-enable @typescript-eslint/naming-convention */
                if (splits.some((s) => s.budgetId === budget_id)) {
                    matched.add(doc.id);
                }
            });
        }
        const ids = Array.from(matched);
        console.log(`[${ctx.trace_id}] get_ids_referencing_budget: budget=${budget_id}, found=${ids.length}`);
        return ids;
    },
    /**
     * Gets one transaction's raw doc data + id, or null if missing/inactive.
     * Returns the raw camelCase map so the assignment resolver can read-modify-
     * write nested splits onto it.
     */
    async get_raw_by_id(_ctx, transaction_id) {
        const doc = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .doc(transaction_id)
            .get();
        if (!doc.exists) {
            return null;
        }
        const data = doc.data();
        if (data.isActive === false) {
            return null;
        }
        return { id: doc.id, data };
    },
    /**
     * Gets active transactions (raw doc data + id) whose `transactionDate` falls
     * in [start_ms, end_ms]. Returns raw maps so callers (spend / re-home
     * resolvers) can map nested splits themselves.
     *
     * Composite index: `transactions(userId, transactionDate)`.
     */
    async get_active_in_date_range(_ctx, user_id, start_ms, end_ms) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .where("transactionDate", ">=", firestore_1.Timestamp.fromMillis(start_ms))
            .where("transactionDate", "<=", firestore_1.Timestamp.fromMillis(end_ms))
            .get();
        return snapshot.docs
            .map((doc) => ({ id: doc.id, data: doc.data() }))
            .filter((t) => t.data.isActive !== false);
    },
    // (cursor writes belong to the plaid_items aggregate → plaid_item_repo.update_cursor)
};
//# sourceMappingURL=transaction.repo.js.map