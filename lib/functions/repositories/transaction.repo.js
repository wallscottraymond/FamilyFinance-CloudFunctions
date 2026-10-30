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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transaction_repo = void 0;
const budget_spend_service_1 = require("../domain/budgets/budget_spend.service");
const outflow_pinned_period_repo_1 = require("./outflow_pinned_period.repo");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
const errors_1 = require("../types/errors");
/**
 * Firestore collection name.
 */
const COLLECTION = "transactions";
/* eslint-enable @typescript-eslint/naming-convention */
// ============================================================================
// Mapping Functions
// ============================================================================
/** A pending split's MANUAL choices (only the ones the user actually made). */
function pending_manual_choices(s) {
    var _a, _b, _c, _d, _e, _f;
    const out = {};
    if (s.budgetAssignmentSource === "manual")
        out.budget_assignment_source = "manual";
    if (s.outflowAssignmentSource === "manual") {
        out.outflow_assignment_source = "manual";
        out.outflow_pinned_period_id = (_a = s.outflowPinnedPeriodId) !== null && _a !== void 0 ? _a : null;
    }
    // A manual bill pin parked while its bill is removed / paused — carried, so Restore finds it.
    if (typeof s.suspendedOutflowPinId === "string" && s.suspendedOutflowPinId) {
        out.suspended_outflow_pin_id = s.suspendedOutflowPinId;
        out.outflow_pinned_period_id = (_b = s.outflowPinnedPeriodId) !== null && _b !== void 0 ? _b : null;
    }
    if (s.inflowAssignmentSource === "manual") {
        out.inflow_assignment_source = "manual";
        out.inflow_id = (_c = s.inflowId) !== null && _c !== void 0 ? _c : null;
    }
    if (s.categorySource === "user") {
        out.category_source = "user";
        out.overall_category_id = (_d = s.overallCategoryId) !== null && _d !== void 0 ? _d : null;
        out.first_category_id = (_e = s.firstCategoryId) !== null && _e !== void 0 ? _e : null;
        out.second_category_id = (_f = s.secondCategoryId) !== null && _f !== void 0 ? _f : null;
    }
    return out;
}
/**
 * Maps legacy Firestore document to PendingTransactionInfo.
 */
function map_to_pending_info(doc) {
    var _a, _b, _c, _d, _e, _f;
    return {
        doc_id: doc.id,
        plaid_transaction_id: doc.transactionId,
        amount: (_d = (_a = doc.amount) !== null && _a !== void 0 ? _a : (_c = (_b = doc.splits) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : 0,
        splits: (doc.splits || []).map(s => (Object.assign({ split_id: s.splitId, amount: s.amount, budget_id: s.budgetId, outflow_id: s.outflowId || null, 
            // A legacy internal* that merely COPIES the split's own Plaid code isn't a user override —
            // never carry it (it would read as a pick once Plaid's code on the posted txn differs).
            internal_primary_category: s.internalPrimaryCategory === s.plaidPrimaryCategory ? null : s.internalPrimaryCategory, internal_detailed_category: s.internalDetailedCategory === s.plaidDetailedCategory ? null : s.internalDetailedCategory, is_default: s.isDefault, tags: s.tags || [], 
            // spendStatus is the source of truth; the booleans are its legacy mirrors.
            is_ignored: (0, budget_spend_service_1.split_spend_status)(s) === "ignored", is_refund: (0, budget_spend_service_1.split_spend_status)(s) === "refund", is_tax_deductible: !!s.isTaxDeductible }, pending_manual_choices(s)))),
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
    var _a, _b, _c;
    const group_ids = entity.group_ids || [];
    return Object.assign(Object.assign(Object.assign(Object.assign({ id: entity.id || "", transactionId: entity.transaction_id, userId: entity.user_id, ownerId: entity.user_id, groupId: group_ids[0] || null, groupIds: group_ids, isPrivate: group_ids.length === 0, transactionDate: firestore_1.Timestamp.fromDate(entity.transaction_date), accountId: entity.account_id, createdBy: entity.user_id, updatedBy: entity.user_id, currency: entity.currency, description: entity.name, internalDetailedCategory: entity.internal_detailed_category, internalPrimaryCategory: entity.internal_primary_category, plaidDetailedCategory: entity.plaid_detailed_category, plaidPrimaryCategory: entity.plaid_primary_category, plaidItemId: entity.plaid_item_id, source: entity.source, transactionStatus: entity.is_pending ? "pending" : "approved", type: entity.type, name: entity.name, merchantName: entity.merchant_name }, (entity.vendor_key !== undefined ? { vendorKey: entity.vendor_key } : {})), { amount: entity.amount, isPending: entity.is_pending, pendingTransactionId: entity.pending_transaction_id, splits: entity.splits.map(s => map_split_to_doc(s, now)), initialPlaidData: {
            plaidAccountId: entity.initial_plaid_data.plaid_account_id,
            plaidMerchantName: entity.initial_plaid_data.plaid_merchant_name,
            plaidName: entity.initial_plaid_data.plaid_name,
            plaidTransactionId: entity.initial_plaid_data.plaid_transaction_id,
            plaidPending: entity.initial_plaid_data.plaid_pending,
            source: "plaid",
        }, createdAt: now, updatedAt: now, isActive: entity.is_active, 
        // Hidden (its account is removed) is inactive but NOT deleted: restore brings it back.
        isDeleted: !entity.is_active && !entity.is_hidden }), (entity.is_hidden ? { isHidden: true, hiddenReason: (_a = entity.hidden_reason) !== null && _a !== void 0 ? _a : null } : {})), { 
        // Rules Engine flags (non-blocking; drive the "Needs review" queue). Written on every doc so the
        // queue query (needsReview == true) is consistent.
        needsReview: (_b = entity.needs_review) !== null && _b !== void 0 ? _b : false, needsNote: (_c = entity.needs_note) !== null && _c !== void 0 ? _c : false, 
        // Denormalized union of splits' tags → array-contains queryable (see LegacyTransactionDoc).
        tagIds: Array.from(new Set(entity.splits.flatMap(s => { var _a; return (_a = s.tags) !== null && _a !== void 0 ? _a : []; }))) });
}
function map_split_to_doc(split, now) {
    var _a, _b, _c, _d, _e;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ splitId: split.split_id, budgetId: split.budget_id, monthlyPeriodId: split.monthly_period_id, weeklyPeriodId: split.weekly_period_id, biWeeklyPeriodId: split.bi_weekly_period_id, outflowId: split.outflow_id, plaidPrimaryCategory: split.plaid_primary_category, plaidDetailedCategory: split.plaid_detailed_category, internalPrimaryCategory: split.internal_primary_category, internalDetailedCategory: split.internal_detailed_category, amount: split.amount, isDefault: split.is_default, isIgnored: split.is_ignored, isRefund: split.is_refund, isTaxDeductible: split.is_tax_deductible, paymentDate: firestore_1.Timestamp.fromDate(split.payment_date), rules: split.rules, tags: split.tags }, (split.budget_assignment_source
        ? { budgetAssignmentSource: split.budget_assignment_source }
        : {})), (split.outflow_assignment_source === "manual"
        ? {
            outflowAssignmentSource: "manual",
            outflowPinnedPeriodId: (_a = split.outflow_pinned_period_id) !== null && _a !== void 0 ? _a : null,
        }
        : {})), (split.suspended_outflow_pin_id
        ? {
            suspendedOutflowPinId: split.suspended_outflow_pin_id,
            outflowPinnedPeriodId: (_b = split.outflow_pinned_period_id) !== null && _b !== void 0 ? _b : null,
        }
        : {})), (split.inflow_assignment_source === "manual" && split.inflow_id
        ? { inflowAssignmentSource: "manual", inflowId: split.inflow_id }
        : {})), (split.category_source === "user"
        ? {
            categorySource: "user",
            overallCategoryId: (_c = split.overall_category_id) !== null && _c !== void 0 ? _c : null,
            firstCategoryId: (_d = split.first_category_id) !== null && _d !== void 0 ? _d : null,
            secondCategoryId: (_e = split.second_category_id) !== null && _e !== void 0 ? _e : null,
        }
        : {})), { createdAt: now, updatedAt: now });
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
    async upsert_from_plaid_sync(ctx, transactions, user_id, plaid_item_id, on_create, 
    // UPDATE-branch hook (Plaid-Modified-Sync-Preserves-Edits): the caller's PURE merge of
    // the fresh Plaid doc into the doc we already hold (keeps the user's splits / tags /
    // review / categories). The repo holds no merge logic; it just applies it on update.
    on_update, opts) {
        var _a, _b;
        if (transactions.length === 0) {
            return { created: 0, updated: 0, results: [], written: [] };
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        let created = 0;
        let updated = 0;
        const results = [];
        const written = [];
        // Stamped on every doc this sync writes so `on_transaction_written` can tell the write came
        // from a sync (which runs its own single follow-up pass) and skip its per-transaction fan-out.
        const tag = (opts === null || opts === void 0 ? void 0 : opts.run_id)
            ? { syncRunId: opts.run_id, lastWriteSource: "plaid_sync" }
            : {};
        // Process in batches
        const chunks = (0, types_1.chunk_for_batch)(transactions);
        try {
            for (const chunk of chunks) {
                // ONE atomic batch per chunk: creates + CONDITIONAL updates (each update only if its doc is
                // unchanged since this read — a user edit saved meanwhile must never be overwritten with
                // the stale copy). A lost race fails the whole batch (nothing written); the chunk is
                // re-read and rebuilt on the newer docs (up to 3 attempts) — so it's all-or-nothing, and
                // the follow-up input (`written`) always matches what was committed.
                let audits = [];
                for (let attempt = 1;; attempt++) {
                    const batch = db.batch();
                    const chunk_results = [];
                    const chunk_written = [];
                    const chunk_audits = [];
                    let chunk_created = 0;
                    let chunk_updated = 0;
                    // Existence lookup for the WHOLE chunk in ⌈N/30⌉ batched `in` queries (matches by the
                    // `transactionId` field, so it finds both deterministic `plaid_${id}` docs AND legacy
                    // random-id docs) — instead of one indexed query PER transaction (the O(N)/sync read line).
                    const update_times = new Map();
                    const existing_docs = await this.get_by_plaid_transaction_ids(ctx, user_id, chunk.map((t) => t.transaction_id), update_times);
                    const existing_by_txn_id = new Map();
                    for (const d of existing_docs) {
                        existing_by_txn_id.set(d.transactionId, {
                            doc_id: d.id,
                            created_at: d.createdAt,
                            doc: d, // full doc, already read by the lookup (the merge needs no extra reads)
                        });
                    }
                    for (const txn of chunk) {
                        const existing = (_a = existing_by_txn_id.get(txn.transaction_id)) !== null && _a !== void 0 ? _a : null;
                        if (existing) {
                            // UPDATE: merge Plaid's fresh fields onto the doc we just read (user edits kept).
                            const fresh_doc = map_to_doc(Object.assign(Object.assign({}, txn), { id: existing.doc_id }), now);
                            fresh_doc.createdAt = existing.created_at; // Preserve original creation time
                            fresh_doc.updatedAt = now;
                            const _c = existing.doc, { id: _existing_id } = _c, existing_doc = __rest(_c, ["id"]);
                            const merged = on_update
                                ? on_update(existing_doc, fresh_doc)
                                : fresh_doc;
                            // Final shape decided BEFORE the write (e.g. the assignment engine run in memory),
                            // so the transaction is written once, finished.
                            const shaped = (opts === null || opts === void 0 ? void 0 : opts.before_write)
                                ? await opts.before_write(existing.doc_id, merged, existing_doc)
                                : merged;
                            const doc_data = Object.assign(Object.assign({}, shaped), tag);
                            const read_time = update_times.get(existing.doc_id);
                            if (read_time) {
                                batch.update(doc_ref(existing.doc_id), doc_data, { lastUpdateTime: read_time });
                            }
                            else {
                                batch.update(doc_ref(existing.doc_id), doc_data);
                            }
                            chunk_results.push({
                                plaid_transaction_id: txn.transaction_id,
                                doc_id: existing.doc_id,
                                action: "updated",
                            });
                            chunk_written.push({ doc_id: existing.doc_id, before: existing_doc, after: doc_data });
                            chunk_audits.push({ doc_id: existing.doc_id, action: "updated" });
                            chunk_updated++;
                        }
                        else {
                            // CREATE: New transaction.
                            // DETERMINISTIC doc id derived from the Plaid transaction_id (NOT random)
                            // so concurrent syncs (the 6h fallback crons + a webhook processing the
                            // same "added" txn) collide on the SAME doc id → one idempotent `set`,
                            // never a duplicate. The pre-check above is not atomic, so a random id
                            // would let both branches create separate docs (the dup bug, 2026-08-18).
                            // `plaid_` prefix avoids Firestore's reserved `.`/`..`/`__*__` id forms;
                            // `/` (illegal in an id) is sanitized. Existing random-id docs stay found
                            // by `get_by_plaid_transaction_id`, so no migration + no split-brain.
                            //
                            // FIRST-WRITE-ONLY hook: apply the caller's pure transform (the Rules Engine) ONLY
                            // on CREATE — never on the update branch above — so rules run exactly once per
                            // transaction and can't clobber a later manual edit. The transform is pure; the
                            // repo holds no rule logic, it just invokes it at the create lifecycle point.
                            const effective = on_create ? on_create(txn) : txn;
                            const doc_id = `plaid_${effective.transaction_id.replace(/\//g, "_")}`;
                            const base = map_to_doc(Object.assign(Object.assign({}, effective), { id: doc_id }), now);
                            const shaped = (opts === null || opts === void 0 ? void 0 : opts.before_write) ? await opts.before_write(doc_id, base, null) : base;
                            const doc_data = Object.assign(Object.assign({}, shaped), tag);
                            batch.set(doc_ref(doc_id), doc_data);
                            chunk_results.push({
                                plaid_transaction_id: txn.transaction_id,
                                doc_id,
                                action: "created",
                            });
                            chunk_written.push({ doc_id, before: null, after: doc_data });
                            chunk_audits.push({ doc_id, action: "created" });
                            chunk_created++;
                        }
                    }
                    try {
                        await batch.commit();
                    }
                    catch (error) {
                        // FAILED_PRECONDITION (a newer write landed) / NOT_FOUND (deleted meanwhile): nothing
                        // was written — re-read and rebuild the chunk on the newer docs.
                        const code = error.code;
                        if ((code === 9 || code === 5) && attempt < 3)
                            continue;
                        throw error;
                    }
                    results.push(...chunk_results);
                    written.push(...chunk_written);
                    audits = chunk_audits;
                    created += chunk_created;
                    updated += chunk_updated;
                    break;
                }
                // ONE audit entry per page (ids only) instead of a full-copy, fire-and-forget entry per
                // transaction — 3,000 audit docs per first link became 6. Awaited so it isn't dropped.
                if (audits.length > 0) {
                    await (0, audit_1.record_audit_entries_batch)([
                        {
                            user_id,
                            action: "update",
                            entity_type: "transaction",
                            entity_id: `plaid_sync:${plaid_item_id}`,
                            before: null,
                            after: {
                                created: audits.filter((a) => a.action === "created").map((a) => a.doc_id),
                                updated: audits.filter((a) => a.action === "updated").map((a) => a.doc_id),
                            },
                            trace_id: ctx.trace_id,
                            metadata: { source: "api", context: { plaid_sync: true, run_id: (_b = opts === null || opts === void 0 ? void 0 : opts.run_id) !== null && _b !== void 0 ? _b : null } },
                        },
                    ]).catch((e) => console.warn(`[${ctx.trace_id}] sync audit write failed (non-fatal):`, e));
                }
            }
        }
        catch (error) {
            // Earlier chunks DID commit: hand their writes to the caller so their follow-ups still run
            // (the failed chunk wrote nothing — it's re-delivered by the next sync).
            if (error && typeof error === "object") {
                error.partial_written = written;
            }
            throw error;
        }
        console.log(`[${ctx.trace_id}] upsert_from_plaid_sync: created=${created}, updated=${updated}`);
        return { created, updated, results, written };
    },
    /**
     * Loads full transaction docs by their PLAID transaction ids (the membership
     * list a recurring outflow/inflow carries in `transactionIds`). Queries by
     * `transactionId` (globally unique → no composite index) and filters to the
     * owner in memory. Batched via Firestore `in` (≤30 per query). Used by the
     * recurring reconciliation resolver.
     */
    async get_by_plaid_transaction_ids(ctx, user_id, plaid_transaction_ids, 
    /** Optional sink: doc id → its update time (for a conditional write; no extra reads). */
    update_times) {
        if (plaid_transaction_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const out = [];
        // `in` takes ≤30 values; run the chunks in parallel (was serial — ~17 round trips per
        // 500-transaction page).
        const chunks = [];
        for (let i = 0; i < plaid_transaction_ids.length; i += 30) {
            chunks.push(plaid_transaction_ids.slice(i, i + 30));
        }
        const snapshots = await Promise.all(chunks.map((chunk) => db.collection(COLLECTION).where("transactionId", "in", chunk).get()));
        for (const snapshot of snapshots) {
            for (const doc of snapshot.docs) {
                const data = doc.data();
                if (data.ownerId === user_id) {
                    out.push(Object.assign(Object.assign({}, data), { id: doc.id }));
                    update_times === null || update_times === void 0 ? void 0 : update_times.set(doc.id, doc.updateTime);
                }
            }
        }
        console.log(`[${ctx.trace_id}] get_by_plaid_transaction_ids: requested=${plaid_transaction_ids.length}, found=${out.length}`);
        return out;
    },
    /**
     * Loads active transactions whose splits are linked to a recurring outflow/inflow,
     * via the denormalized queryable `splitOutflowIds` / `splitInflowIds`
     * (`array-contains`). This is the DURABLE link (stamped by the assignment engine),
     * which survives Plaid's id reissue on pending→posted — unlike the recurring's
     * stale stream `transactionIds[]`. Returns docs with `id` populated.
     *
     * @param ctx - Trace context
     * @param user_id - Owner (filtered in memory to avoid a composite index)
     * @param recurring_type - "outflow" | "inflow"
     * @param recurring_id - The recurring definition id
     */
    async get_by_split_recurring_link(ctx, user_id, recurring_type, recurring_id) {
        if (!recurring_id)
            return [];
        const field = recurring_type === "outflow" ? "splitOutflowIds" : "splitInflowIds";
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where(field, "array-contains", recurring_id)
            .get();
        const out = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if (data.ownerId === user_id && data.isActive !== false) {
                out.push(Object.assign(Object.assign({}, data), { id: doc.id }));
            }
        }
        console.log(`[${ctx.trace_id}] get_by_split_recurring_link: ${recurring_type}=${recurring_id}, found=${out.length}`);
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
     * A user's ACTIVE transactions of one vendor from `from_ms` on, newest first, capped. Uses the
     * existing composite index `(userId, isActive, vendorKey, transactionDate DESC)`; the caller
     * filters the account in memory (no new index). Reads one doc per row returned — the cap bounds
     * the busiest vendor. A transaction written before `vendorKey` was stored isn't found here.
     */
    async get_by_vendor_key(_ctx, user_id, vendor_key, from_ms, 
    /** Rows kept in total (the account filter happens after, so this pages until it is reached). */
    max_rows = 3000) {
        const PAGE = 600;
        const out = [];
        let cursor;
        while (out.length < max_rows) {
            let q = (0, firestore_1.getFirestore)()
                .collection(COLLECTION)
                .where("userId", "==", user_id)
                .where("isActive", "==", true)
                .where("vendorKey", "==", vendor_key)
                .where("transactionDate", ">=", firestore_1.Timestamp.fromMillis(from_ms))
                .orderBy("transactionDate", "desc")
                .limit(PAGE);
            if (cursor)
                q = q.startAfter(cursor);
            const snap = await q.get();
            for (const d of snap.docs)
                out.push({ id: d.id, data: d.data() });
            if (snap.size < PAGE)
                break;
            cursor = snap.docs[snap.docs.length - 1];
        }
        return out;
    },
    /**
     * An account's ACTIVE transactions from `from_ms` on, newest first (existing index
     * `(ownerId, accountId, transactionDate DESC)`), capped. Only the convert's fallback for a source
     * transaction written before `vendorKey` was stored: the caller computes the key in memory.
     */
    async get_account_window(_ctx, user_id, account_id, from_ms, limit = 1500) {
        const snap = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("ownerId", "==", user_id)
            .where("accountId", "==", account_id)
            .where("transactionDate", ">=", firestore_1.Timestamp.fromMillis(from_ms))
            .orderBy("transactionDate", "desc")
            .limit(limit)
            .get();
        return snap.docs
            .map((d) => ({ id: d.id, data: d.data() }))
            .filter((t) => t.data.isActive !== false);
    },
    /**
     * An owner's newest transactions, newest first, capped (existing index
     * `(ownerId, transactionDate DESC)`, the same query the app's Home "Recent transactions" card
     * pages). Raw docs, any state: the caller drops soft-deleted / out-of-view rows in memory (there
     * is no isActive + date index). Only the fields a recent-transactions row needs (`select`).
     */
    async get_latest_by_owner(_ctx, owner_id, limit) {
        const snap = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("ownerId", "==", owner_id)
            .orderBy("transactionDate", "desc")
            .limit(limit)
            .select("userId", "accountId", "transactionDate", "isActive", "isDeleted", "isPending", "pending", "transactionStatus", "merchantName", "metadata", "name", "description", "amount", "type", "transferRole", "splits")
            .get();
        return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
    /**
     * Manually PIN a split to a recurring bill (outflow) or CLEAR the pin (outflow_id
     * = null), or DETACH it from bills (`outflow_id = null` + `detach`: a manual pin to
     * "none" — "remove from bill" — that beats auto/stream re-linking; see
     * domain/recurring/stream_membership `is_split_detached_from_outflow`).
     * Sets the split's `outflowId` + `outflowAssignmentSource="manual"` (so the
     * Assignment Engine preserves it across re-syncs) and recomputes the durable
     * `splitOutflowIds` denorm (which the recurring reconcile queries). The resulting
     * write fires `on_transaction_written`, which enqueues the reconcile for the
     * affected bill(s) across before∪after — marking the bill paid. Structural guards
     * only (ownership, existence); no business logic.
     */
    async pin_split_to_outflow(ctx, doc_id, split_id, outflow_id, user_id, clear_budget = false, outflow_period_id = null, detach = false) {
        const ref = doc_ref(doc_id);
        // Read + write in ONE Firestore transaction: a concurrent edit (a status tap, a sync) is never
        // overwritten with a stale copy of the splits (Firestore retries on contention).
        const { before, update_data } = await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a;
            const snap = await tx.get(ref);
            if (!snap.exists) {
                throw new errors_1.NotFoundError("transaction", doc_id);
            }
            const before = snap.data();
            const owner = before.userId;
            if (before.ownerId !== user_id && owner !== user_id) {
                throw new errors_1.PermissionDeniedError("assign_split_to_outflow", doc_id);
            }
            // The bill must be the caller's own (Convert-To-Recurring Phase 2 review: a guessable
            // `conv_…` id of someone else's bill must never be pinned — it would enqueue reconciles for
            // it and leave a dangling `splitOutflowIds`). One extra read, only when pinning to a bill.
            if (outflow_id) {
                const bill = await tx.get((0, firestore_1.getFirestore)().collection("outflows").doc(outflow_id));
                if (!bill.exists || bill.data().ownerId !== user_id) {
                    throw new errors_1.PermissionDeniedError("assign_split_to_outflow", outflow_id);
                }
            }
            /* eslint-disable @typescript-eslint/naming-convention */
            const splits = ((_a = before.splits) !== null && _a !== void 0 ? _a : []).map((s) => s.splitId === split_id
                ? Object.assign(Object.assign(Object.assign({}, s), { outflowId: outflow_id, 
                    // Pin manually so a future sync/engine pass preserves it; clearing (null)
                    // reverts to auto-derivation unless it's a DETACH (manual pin to "no bill").
                    outflowAssignmentSource: outflow_id || detach ? "manual" : "auto", 
                    // Optional period pin (Bill-Assignment-Two-Stage-Picker): force the recurring
                    // reconcile to place this payment in a SPECIFIC period (sourcePeriodId),
                    // overriding date-based alignment. Cleared when the bill pin is cleared.
                    outflowPinnedPeriodId: outflow_id ? outflow_period_id : null, inflowId: null, suspendedOutflowPinId: null }), (clear_budget ? { budgetId: "", budgetName: "" } : {})) : s);
            /* eslint-enable @typescript-eslint/naming-convention */
            if (!splits.some((s) => s.splitId === split_id)) {
                throw new errors_1.NotFoundError("transaction_split", split_id);
            }
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const splitOutflowIds = Array.from(new Set(splits
                .map((s) => s.outflowId)
                .filter((id) => !!id)));
            const now = firestore_1.Timestamp.now();
            // The pin nulls the split's income link, so the income denorm is recomputed with it (it was
            // left stale before).
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const splitInflowIds = Array.from(new Set(splits.map((s) => s.inflowId).filter((id) => !!id)));
            // eslint-disable-next-line @typescript-eslint/naming-convention
            const update_data = { splits, splitOutflowIds, splitInflowIds, updatedAt: now, updatedBy: user_id };
            tx.update(ref, update_data);
            // Record the pinned period for the bill in the SAME transaction (outflow_pinned_period.repo):
            // the period page loads only the payments dated in the period it shows, so a payment pinned
            // there from another period (a late payment of an overdue month) is found through it.
            if (outflow_id && outflow_period_id) {
                /* eslint-disable @typescript-eslint/naming-convention */
                tx.set((0, firestore_1.getFirestore)()
                    .collection(outflow_pinned_period_repo_1.OUTFLOW_PINNED_PERIODS_COLLECTION)
                    .doc((0, outflow_pinned_period_repo_1.outflow_pinned_period_doc_id)(user_id, outflow_id)), {
                    ownerId: user_id,
                    outflowId: outflow_id,
                    periodIds: firestore_1.FieldValue.arrayUnion(outflow_period_id),
                    updatedAt: now,
                }, { merge: true });
                /* eslint-enable @typescript-eslint/naming-convention */
            }
            return { before, update_data };
        });
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "transaction",
            entity_id: doc_id,
            before: before,
            after: Object.assign(Object.assign({}, before), update_data),
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { manual_outflow_pin: true, outflow_id, detach } },
        });
        console.log(`[${ctx.trace_id}] pin_split_to_outflow: txn=${doc_id} split=${split_id} → ` +
            `outflow=${outflow_id !== null && outflow_id !== void 0 ? outflow_id : (detach ? "detached" : "cleared")}`);
        return (0, types_1.create_write_result)("transaction", doc_id, "merge", before, Object.assign(Object.assign({}, before), update_data));
    },
    /**
     * Manually PIN a split to a recurring INCOME (`inflow_id`) or CLEAR the pin (null) — the income
     * twin of `pin_split_to_outflow`. One Firestore transaction reads the transaction and the income
     * and checks BOTH owners structurally (the caller owns the transaction and the income); the
     * business rules (credit only, same view, …) are decided by the domain before this is called.
     * `mutate` is the domain's pure edit of the split. Recomputes BOTH durable denorms
     * (`splitInflowIds` and `splitOutflowIds`: a pin clears the split's bill link). Unstamped, like
     * the bill pin: its write fires `on_transaction_written` (assignment + reconcile of the
     * touched streams).
     */
    async pin_split_to_inflow(ctx, doc_id, split_id, inflow_id, user_id, mutate) {
        const ref = doc_ref(doc_id);
        const { before, update_data } = await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a, _b;
            const [snap, inflow] = await Promise.all([
                tx.get(ref),
                inflow_id ? tx.get((0, firestore_1.getFirestore)().collection("inflows").doc(inflow_id)) : Promise.resolve(null),
            ]);
            if (!snap.exists)
                throw new errors_1.NotFoundError("transaction", doc_id);
            const before = snap.data();
            if (before.ownerId !== user_id && before.userId !== user_id) {
                throw new errors_1.PermissionDeniedError("assign_split_to_inflow", doc_id);
            }
            if (inflow_id && (!(inflow === null || inflow === void 0 ? void 0 : inflow.exists) || inflow.data().ownerId !== user_id)) {
                throw new errors_1.PermissionDeniedError("assign_split_to_inflow", inflow_id);
            }
            if (!((_a = before.splits) !== null && _a !== void 0 ? _a : []).some((s) => s.splitId === split_id)) {
                throw new errors_1.NotFoundError("transaction_split", split_id);
            }
            const splits = ((_b = before.splits) !== null && _b !== void 0 ? _b : []).map((s) => (s.splitId === split_id ? mutate(s) : s));
            const ids = (field) => Array.from(new Set(splits.map((s) => s[field]).filter((id) => !!id)));
            /* eslint-disable @typescript-eslint/naming-convention */
            const update_data = {
                splits,
                splitOutflowIds: ids("outflowId"),
                splitInflowIds: ids("inflowId"),
                updatedAt: firestore_1.Timestamp.now(),
                updatedBy: user_id,
            };
            /* eslint-enable @typescript-eslint/naming-convention */
            tx.update(ref, update_data);
            return { before, update_data };
        });
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "transaction",
            entity_id: doc_id,
            before: before,
            after: Object.assign(Object.assign({}, before), update_data),
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { manual_inflow_pin: true, inflow_id } },
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
    async soft_delete_by_plaid_ids(ctx, user_id, plaid_transaction_ids, reason, opts) {
        var _a;
        if (plaid_transaction_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        // Query for all transactions by Plaid IDs. `in` accepts at most 30 values — the old
        // 500-id chunks made any page with >30 removals throw (removals silently never applied).
        const chunks = (0, types_1.chunk_for_batch)(plaid_transaction_ids, 30);
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
                const update_data = Object.assign(Object.assign({ isActive: false, isDeleted: true, deletionReason: reason, updatedAt: now }, (before.hiddenReason ? { hiddenReason: null } : {})), ((opts === null || opts === void 0 ? void 0 : opts.run_id) ? { syncRunId: opts.run_id, lastWriteSource: "plaid_sync" } : {}));
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(doc.ref, update_data);
                (_a = opts === null || opts === void 0 ? void 0 : opts.written) === null || _a === void 0 ? void 0 : _a.push({
                    doc_id: doc.id,
                    before: before,
                    after: Object.assign(Object.assign({}, before), update_data),
                });
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
        var _a, _b, _c;
        const db = (0, firestore_1.getFirestore)();
        // Recently removed-by-Plaid-sync pendings only, within a window covering the
        // pending lifecycle (Plaid posts 1–5 business days out).
        const REMOVED_WINDOW_MS = 12 * 24 * 60 * 60 * 1000;
        const cutoff_ms = Date.now() - REMOVED_WINDOW_MS;
        // ACTIVE pendings — the common (same-sync) case. PLUS recently REMOVED-BY-SYNC
        // pendings — so a posted arriving in a LATER sync (after Plaid already removed the
        // pending) can STILL inherit the user's splits. The removed query is bounded by
        // `updatedAt >= cutoff` (Read-Cost-Review-Round-3 Q5): it used to read EVERY soft-deleted
        // pending the item ever had, then drop all but the last 12 days in memory — same result,
        // now without reading the old ones. Index: ownerId+plaidItemId+isPending+isActive+updatedAt.
        const [active_snap, removed_snap] = await Promise.all([
            db
                .collection(COLLECTION)
                .where("ownerId", "==", user_id)
                .where("plaidItemId", "==", plaid_item_id)
                .where("isPending", "==", true)
                .where("isActive", "==", true)
                .get(),
            db
                .collection(COLLECTION)
                .where("ownerId", "==", user_id)
                .where("plaidItemId", "==", plaid_item_id)
                .where("isPending", "==", true)
                .where("isActive", "==", false)
                .where("updatedAt", ">=", firestore_1.Timestamp.fromMillis(cutoff_ms))
                .get(),
        ]);
        const result = new Map();
        for (const doc of active_snap.docs) {
            const data = doc.data();
            result.set(data.transactionId, map_to_pending_info(data));
        }
        // Don't overwrite an active. (The cutoff re-check below is now redundant with the
        // query bound but kept as a guard.)
        let removed_recent = 0;
        for (const doc of removed_snap.docs) {
            const data = doc.data();
            const removed_by_sync = data.isDeleted === true &&
                typeof data.deletionReason === "string" &&
                data.deletionReason.toLowerCase().includes("removed by plaid");
            const updated_ms = (_c = (_b = (_a = data.updatedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0;
            if (!removed_by_sync || updated_ms < cutoff_ms)
                continue;
            if (result.has(data.transactionId))
                continue; // an active pending wins
            result.set(data.transactionId, map_to_pending_info(data));
            removed_recent++;
        }
        console.log(`[${ctx.trace_id}] get_pending_transactions_for_item: found=${result.size} ` +
            `(active=${active_snap.size}, removed-recent=${removed_recent})`);
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
     * Bulk-reads the FULL active transaction docs for a set of ids via chunked `getAll` (≤300/call).
     * Used by the batch assignment path to read each txn ONCE — instead of a per-transaction
     * `get_raw_by_id` inside `resolve_assignment_context` (N single-doc reads per sync). The dates
     * come along for free (so the candidate-window probe is no longer a separate read). Missing /
     * inactive docs are skipped.
     */
    async get_raw_by_ids(_ctx, doc_ids) {
        if (doc_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const out = [];
        const CHUNK = 300; // Firestore getAll practical batch size
        for (let i = 0; i < doc_ids.length; i += CHUNK) {
            const refs = doc_ids.slice(i, i + CHUNK).map((id) => doc_ref(id));
            const snaps = await db.getAll(...refs);
            for (const snap of snaps) {
                if (!snap.exists)
                    continue;
                const data = snap.data();
                if (data.isActive === false)
                    continue;
                out.push({ id: snap.id, data, update_time: snap.updateTime });
            }
        }
        return out;
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
     * @param split_outflow_ids - Distinct recurring-outflow links (queryable)
     * @param split_inflow_ids - Distinct recurring-inflow links (queryable)
     */
    async apply_split_assignments(_ctx, doc_id, updated_splits, split_budget_ids, split_outflow_ids = [], split_inflow_ids = [], 
    /** The assignment run writing this — lets `on_transaction_written` skip the engine's own
     *  writes (the batch runs its own single follow-up instead of N re-entries). */
    assign_run_id, 
    /** Extra top-level fields written in the SAME update (e.g. the 3-0b legacy clear). */
    extra_fields, 
    /** The doc's update time when it was read: the write fails (returns false) if anything
     *  changed it since (a user edit, a sync) — never overwrite a newer write. */
    read_update_time) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const data = Object.assign(Object.assign(Object.assign({}, (extra_fields !== null && extra_fields !== void 0 ? extra_fields : {})), (assign_run_id ? { assignRunId: assign_run_id, lastWriteSource: "assignment" } : {})), { splits: updated_splits, splitBudgetIds: split_budget_ids, 
            // Queryable durable txn↔recurring links (array-contains) — power recurring
            // reconciliation without the stale Plaid stream transactionIds[].
            splitOutflowIds: split_outflow_ids, splitInflowIds: split_inflow_ids, updatedAt: firestore_1.Timestamp.now() });
        /* eslint-enable @typescript-eslint/naming-convention */
        try {
            if (read_update_time) {
                await doc_ref(doc_id).update(data, { lastUpdateTime: read_update_time });
            }
            else {
                await doc_ref(doc_id).update(data);
            }
            return true;
        }
        catch (error) {
            // FAILED_PRECONDITION: the doc changed after we read it — its newer writer (an edit's
            // trigger, a sync's in-memory assignment) assigns it; skipping is the safe outcome.
            if (error.code === 9)
                return false;
            throw error;
        }
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
     * Hides up to 500 active transactions for a removed account (one page).
     * Inactive transactions drop out of every derived total. Idempotent. Returns
     * the count hidden and whether a full page came back (more may remain).
     */
    async hide_for_account(ctx, account_id, user_id) {
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
     * Restores up to 500 transactions that an account removal hid (one page) —
     * only `hiddenReason == "account_removed"`, so transactions soft-deleted for
     * other reasons (e.g. superseded pendings) stay deleted. Idempotent. Returns
     * the count restored and whether a full page came back (more may remain).
     */
    async restore_for_account(ctx, account_id, user_id) {
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const snapshot = await db
            .collection(COLLECTION)
            .where("accountId", "==", account_id)
            .where("ownerId", "==", user_id)
            .where("isActive", "==", false)
            .where("hiddenReason", "==", "account_removed")
            .select()
            .limit(500)
            .get();
        if (snapshot.empty) {
            return { restored: 0, has_more: false };
        }
        let restored = 0;
        for (const chunk of (0, types_1.chunk_for_batch)(snapshot.docs.map((d) => d.id))) {
            const batch = db.batch();
            for (const id of chunk) {
                /* eslint-disable @typescript-eslint/naming-convention */
                batch.update(doc_ref(id), {
                    isActive: true,
                    isHidden: false,
                    hiddenReason: null,
                    hiddenAt: null,
                    updatedAt: now,
                });
                /* eslint-enable @typescript-eslint/naming-convention */
                restored++;
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] restore_for_account: account=${account_id}, restored=${restored}`);
        return { restored, has_more: snapshot.size === 500 };
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
     * @param limit - Optional hard cap on IDs returned. Omit (default) to return
     *   ALL active transaction IDs via pagination — required for full coverage.
     * @returns Array of transaction document IDs
     */
    async get_ids_by_user_id(ctx, user_id, limit) {
        const db = (0, firestore_1.getFirestore)();
        const PAGE = 5000;
        const ids = [];
        let cursor;
        // Paginate by document id (implicit __name__ order — no composite index) so
        // users with more than one page of transactions are FULLY covered. A fixed
        // cap here silently under-covers the backfill/re-assignment work-list, which
        // strands the tail of a large account (the bug that left 291 transfers in EE).
        for (;;) {
            let query = db
                .collection(COLLECTION)
                .where("userId", "==", user_id)
                .where("isActive", "==", true)
                .orderBy(firestore_1.FieldPath.documentId())
                .select() // Document IDs only
                .limit(PAGE);
            if (cursor) {
                query = query.startAfter(cursor);
            }
            const snapshot = await query.get();
            if (snapshot.empty)
                break;
            for (const doc of snapshot.docs) {
                ids.push(doc.id);
            }
            if (limit && ids.length >= limit) {
                return ids.slice(0, limit);
            }
            if (snapshot.size < PAGE)
                break; // last page
            cursor = snapshot.docs[snapshot.docs.length - 1].id;
        }
        console.log(`[${ctx.trace_id}] get_ids_by_user_id: user=${user_id}, found=${ids.length}`);
        return ids;
    },
    /**
     * Gets active transaction IDs whose `updatedAt` is STRICTLY AFTER `since_ms`, oldest first
     * (field-masked — ids only). Powers the debounced per-user batch assignment: a Plaid-sync burst
     * writes many txns → one batch job re-assigns just the recently-changed ones via
     * `assign_transactions_batch` (shared context + candidates resolved ONCE) instead of one
     * per-transaction job each re-reading every reference collection. `limit` caps a single pass;
     * the caller advances its watermark and re-runs if it hit the cap.
     *
     * Composite index: `transactions(userId, updatedAt)`.
     */
    async get_ids_updated_since(_ctx, user_id, since_ms, limit) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .where("updatedAt", ">", firestore_1.Timestamp.fromMillis(since_ms))
            .orderBy("updatedAt", "asc")
            .select("updatedAt") // ids + the cursor field only
            .limit(limit)
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            updated_ms: doc.get("updatedAt").toMillis(),
        }));
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
        // Filter to ONLY the txns that reference this budget, server-side, via the denormalized
        // `splitBudgetIds` union array (`array-contains`) — NOT a full-collection scan of the user's
        // active txns followed by an in-memory `includes()`. A heavy account has thousands of active
        // txns; the old scan read them all (billed per doc + OOM risk on the 256MiB delete fn), where
        // only a handful reference the deleted budget. Needs the composite index
        // (ownerId, isActive, splitBudgetIds CONTAINS). `.select()` projects to zero fields — we only
        // need the ids. `ownerId == userId` for every non-shared txn (both written from the same source
        // in map_to_doc); re-add a userId leg behind the RBAC-sharing flag if cross-owner txns exist.
        const owner_snap = await db
            .collection(COLLECTION)
            .where("ownerId", "==", user_id)
            .where("isActive", "==", true)
            .where("splitBudgetIds", "array-contains", budget_id)
            .select()
            .get();
        const ids = owner_snap.docs.map((doc) => doc.id);
        console.log(`[${ctx.trace_id}] get_ids_referencing_budget: budget=${budget_id}, found=${ids.length}`);
        return ids;
    },
    /**
     * Clears the Rules Engine review flags on a transaction (the "Needs review" queue action).
     * `updatedAt` is bumped; nothing assignment/spend-relevant changes so the write is cheap.
     */
    async clear_review_flags(_ctx, doc_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(doc_id).update({
            needsReview: false,
            needsNote: false,
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
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
    /** Raw partial update of one transaction (fields already in Firestore shape). */
    async update_raw(_ctx, doc_id, fields) {
        await doc_ref(doc_id).update(fields);
    },
    /** `update_raw` only if the doc is unchanged since `read_update_time`; false when a newer
     *  write landed (FAILED_PRECONDITION) — the caller re-reads and rebuilds its edit. */
    async update_raw_if_unchanged(_ctx, doc_id, fields, read_update_time) {
        try {
            await doc_ref(doc_id).update(fields, { lastUpdateTime: read_update_time });
            return true;
        }
        catch (error) {
            if (error.code === 9)
                return false;
            throw error;
        }
    },
    /**
     * Store each transaction's transfer role (3d — internal / edge_out / edge_in / external), only
     * for the ones that changed. A role change is an assignment input (field guard), so the
     * debounced per-user assignment batch re-assigns exactly those.
     */
    async set_transfer_roles(_ctx, roles, 
    /** Stamped (assignRunId) — the caller re-assigns these itself; the trigger skips them. */
    run_id) {
        const db = (0, firestore_1.getFirestore)();
        const entries = [...roles.entries()];
        for (let i = 0; i < entries.length; i += 450) {
            const batch = db.batch();
            for (const [id, role] of entries.slice(i, i + 450)) {
                /* eslint-disable @typescript-eslint/naming-convention */
                batch.update(doc_ref(id), {
                    transferRole: role,
                    assignRunId: run_id,
                    lastWriteSource: "transfer_roles",
                    updatedAt: firestore_1.Timestamp.now(),
                });
                /* eslint-enable @typescript-eslint/naming-convention */
            }
            await batch.commit();
        }
        return entries.length;
    },
    /**
     * One page of a user's transactions in DATE order (then doc id), starting after `cursor` —
     * the bounded re-assign engine's walk (3-R): each page's dates are contiguous, so its
     * recurring-candidate preload stays narrow. Inactive docs are dropped after the read (they still
     * advance the cursor via `last`).
     *
     * Composite index: `transactions(userId, transactionDate)` (doc id is the implicit tiebreak).
     */
    async get_page_by_date(_ctx, user_id, cursor, limit, scope = {}) {
        var _a;
        let q = (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .orderBy("transactionDate", "asc")
            .orderBy(firestore_1.FieldPath.documentId(), "asc");
        // Account-scoped (a view change): query just those accounts — index
        // transactions(userId, accountId, transactionDate). Up to Firestore's 30 `in` values.
        if (((_a = scope.account_ids) === null || _a === void 0 ? void 0 : _a.length) && scope.account_ids.length <= 30) {
            q = q.where("accountId", "in", scope.account_ids);
        }
        if (scope.from_ms !== undefined) {
            q = q.where("transactionDate", ">=", firestore_1.Timestamp.fromMillis(scope.from_ms));
        }
        if (scope.to_ms !== undefined) {
            q = q.where("transactionDate", "<=", firestore_1.Timestamp.fromMillis(scope.to_ms));
        }
        if (cursor) {
            q = q.startAfter(firestore_1.Timestamp.fromMillis(cursor.date_ms), cursor.doc_id);
        }
        const snap = await q.limit(limit).get();
        const tail = snap.docs[snap.docs.length - 1];
        return {
            docs: snap.docs
                .map((d) => ({
                id: d.id,
                data: d.data(),
                update_time: d.updateTime,
            }))
                .filter((t) => t.data.isActive !== false),
            last: tail
                ? {
                    date_ms: tail.get("transactionDate").toMillis(),
                    doc_id: tail.id,
                }
                : cursor,
            exhausted: snap.docs.length < limit,
        };
    },
    /**
     * Sets a split's tags (or every split's tags when `split_id` is null — the whole-transaction
     * case) and recomputes the top-level `tagIds` union. `splits_raw` is the already-read raw splits
     * array from `get_raw_by_id`, so this costs one write (the caller did the read + owner check).
     */
    async write_split_tags(_ctx, doc_id, splits_raw, split_id, tag_ids) {
        /* eslint-disable @typescript-eslint/naming-convention */
        void splits_raw; // the caller's copy may be stale — the splits are re-read in the transaction
        const ref = doc_ref(doc_id);
        // Read + write in ONE Firestore transaction (a concurrent edit is never overwritten).
        await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                throw new errors_1.NotFoundError("transaction", doc_id);
            const raw = snap.data().splits;
            const splits = Array.isArray(raw) ? raw : [];
            for (const s of splits) {
                if (split_id === null || s.splitId === split_id) {
                    s.tags = tag_ids;
                }
            }
            const tagIds = Array.from(new Set(splits.flatMap((s) => (Array.isArray(s.tags) ? s.tags : []))));
            tx.update(ref, { splits, tagIds, updatedAt: firestore_1.Timestamp.now() });
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Removes `tag_id` from every split's `tags` and from the top-level `tagIds` on all of the
     * user's tagged transactions. Bounded batch (500-doc commits). Returns the count stripped.
     * Composite index: `transactions(userId, tagIds array-contains)`.
     */
    async strip_tag(_ctx, user_id, tag_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .where("tagIds", "array-contains", tag_id)
            .get();
        // Each transaction is stripped in its OWN Firestore transaction (re-read + write), so a
        // concurrent edit to it is never overwritten with this query's stale copy. Bounded concurrency.
        let count = 0;
        const strip_one = async (ref) => db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                return false;
            const data = snap.data();
            const splits = Array.isArray(data.splits)
                ? data.splits
                : [];
            for (const s of splits) {
                if (Array.isArray(s.tags)) {
                    s.tags = s.tags.filter((t) => t !== tag_id);
                }
            }
            const tagIds = Array.from(new Set(splits.flatMap((s) => (Array.isArray(s.tags) ? s.tags : []))));
            tx.update(ref, { splits, tagIds, updatedAt: firestore_1.Timestamp.now() });
            return true;
        });
        for (let i = 0; i < snapshot.docs.length; i += 20) {
            const done = await Promise.all(snapshot.docs.slice(i, i + 20).map((d) => strip_one(d.ref)));
            count += done.filter(Boolean).length;
        }
        return count;
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    // (cursor writes belong to the plaid_items aggregate → plaid_item_repo.update_cursor)
};
//# sourceMappingURL=transaction.repo.js.map