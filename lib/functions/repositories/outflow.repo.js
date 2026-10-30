"use strict";
/**
 * Outflow Repository
 *
 * Handles persistence for recurring expenses (outflows).
 * Supports Plaid sync with upsert logic.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/outflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.outflow_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
/** The create is attempt 1; a convert that keeps failing is given up after this many. */
const MAX_CONVERT_ATTEMPTS = 3;
const recurring_suppression_service_1 = require("../domain/recurring/recurring_suppression.service");
const audit_1 = require("../audit");
const convert_doc_fields_1 = require("./convert_doc_fields");
const recurring_doc_equality_1 = require("./recurring_doc_equality");
const manual_settlement_doc_1 = require("./manual_settlement_doc");
/**
 * Firestore collection name.
 */
const COLLECTION = "outflows";
/* eslint-enable @typescript-eslint/naming-convention */
/** Map stored interval docs → domain intervals (defaults to empty). */
function map_removal_intervals(docs) {
    return (docs !== null && docs !== void 0 ? docs : []).map((d) => ({ from_ms: d.fromMs, to_ms: d.toMs, mode: d.mode }));
}
/** Map domain intervals → stored interval docs. */
function to_removal_interval_docs(intervals) {
    /* eslint-disable @typescript-eslint/naming-convention */
    return intervals.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms, mode: i.mode }));
    /* eslint-enable @typescript-eslint/naming-convention */
}
/**
 * Maps legacy Firestore document to Outflow entity.
 */
function map_to_entity(doc) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    return Object.assign(Object.assign({ id: doc.id, user_id: doc.ownerId, group_ids: (_a = doc.groupIds) !== null && _a !== void 0 ? _a : (doc.groupId ? [doc.groupId] : []), is_active: doc.isActive, created_at: doc.createdAt, updated_at: doc.updatedAt, plaid_item_id: doc.plaidItemId, plaid_stream_id: doc.id, account_id: doc.accountId, last_amount: doc.lastAmount, average_amount: doc.averageAmount, amount_min: undefined, amount_max: undefined, currency: doc.currency, expected_amount_override: (_b = doc.expectedAmountOverride) !== null && _b !== void 0 ? _b : null, description: doc.description, merchant_name: doc.merchantName, user_custom_name: doc.userCustomName, frequency: doc.frequency, first_date: doc.firstDate, last_date: doc.lastDate, predicted_next_date: doc.predictedNextDate, plaid_primary_category: doc.plaidPrimaryCategory, plaid_detailed_category: doc.plaidDetailedCategory, internal_primary_category: doc.internalPrimaryCategory, internal_detailed_category: doc.internalDetailedCategory, expense_type: (_c = doc.expenseType) !== null && _c !== void 0 ? _c : "other", is_essential: (_d = doc.isEssential) !== null && _d !== void 0 ? _d : false, type: doc.type, status: "active", source: doc.source, plaid_status: (_e = doc.plaidStatus) !== null && _e !== void 0 ? _e : "UNKNOWN", plaid_confidence_level: (_f = doc.plaidConfidenceLevel) !== null && _f !== void 0 ? _f : null, is_hidden: doc.isHidden, is_user_modified: doc.isUserModified, transaction_ids: doc.transactionIds, tags: doc.tags, rules: doc.rules, removed_by_user: (_g = doc.removedByUser) !== null && _g !== void 0 ? _g : false, removal_intervals: map_removal_intervals(doc.removalIntervals), manual_settled_occurrences: (0, manual_settlement_doc_1.map_manual_settled_occurrences)(doc.manualSettledOccurrences), capture_rules_version: (_h = doc.captureRulesVersion) !== null && _h !== void 0 ? _h : null, plaid_is_active: (_j = doc.plaidIsActive) !== null && _j !== void 0 ? _j : null, plaid_inactive_ack_at_ms: (_m = (_l = (_k = doc.plaidInactiveAckAt) === null || _k === void 0 ? void 0 : _k.toMillis) === null || _l === void 0 ? void 0 : _l.call(_k)) !== null && _m !== void 0 ? _m : null, merged_into_id: (_o = doc.mergedIntoId) !== null && _o !== void 0 ? _o : null }, (0, convert_doc_fields_1.map_convert_fields_to_entity)(doc)), { user_frequency: (_p = doc.userFrequency) !== null && _p !== void 0 ? _p : null, last_synced_at: doc.lastSyncedAt });
}
/**
 * Maps OutflowForPersistence to legacy Firestore document.
 */
function map_persistence_to_doc(entity, now, existing) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    /* eslint-disable @typescript-eslint/naming-convention */
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: entity.id, ownerId: entity.owner_id, createdBy: entity.created_by, updatedBy: entity.updated_by, groupId: (_a = entity.group_ids[0]) !== null && _a !== void 0 ? _a : null, groupIds: entity.group_ids, 
        // A record merged into another keeps OUR active flag: Plaid's never turns it off again (D41).
        isActive: (existing === null || existing === void 0 ? void 0 : existing.mergedIntoId) ? existing.isActive : entity.is_active, createdAt: (_b = existing === null || existing === void 0 ? void 0 : existing.createdAt) !== null && _b !== void 0 ? _b : now, updatedAt: now, plaidItemId: entity.plaid_item_id, accountId: entity.account_id, lastAmount: entity.last_amount, averageAmount: entity.average_amount, 
        // Preserve the user's expected-amount override across Plaid re-sync (Plaid
        // refreshes averageAmount, but the override keeps driving the expected value).
        expectedAmountOverride: (_d = (_c = existing === null || existing === void 0 ? void 0 : existing.expectedAmountOverride) !== null && _c !== void 0 ? _c : entity.expected_amount_override) !== null && _d !== void 0 ? _d : null, currency: entity.currency, description: entity.description, merchantName: entity.merchant_name, userCustomName: (_e = existing === null || existing === void 0 ? void 0 : existing.userCustomName) !== null && _e !== void 0 ? _e : entity.user_custom_name, 
        // A schedule the user picked (tracking a Plaid suggestion, D8) wins over Plaid's guess.
        frequency: (_g = (_f = existing === null || existing === void 0 ? void 0 : existing.userFrequency) !== null && _f !== void 0 ? _f : entity.user_frequency) !== null && _g !== void 0 ? _g : entity.frequency, firstDate: firestore_1.Timestamp.fromDate(entity.first_date), lastDate: firestore_1.Timestamp.fromDate(entity.last_date), predictedNextDate: entity.predicted_next_date
            ? firestore_1.Timestamp.fromDate(entity.predicted_next_date)
            : null, plaidPrimaryCategory: entity.plaid_primary_category, plaidDetailedCategory: entity.plaid_detailed_category, internalPrimaryCategory: (_h = existing === null || existing === void 0 ? void 0 : existing.internalPrimaryCategory) !== null && _h !== void 0 ? _h : entity.internal_primary_category, internalDetailedCategory: (_j = existing === null || existing === void 0 ? void 0 : existing.internalDetailedCategory) !== null && _j !== void 0 ? _j : entity.internal_detailed_category, expenseType: entity.expense_type, isEssential: entity.is_essential, type: (_k = existing === null || existing === void 0 ? void 0 : existing.type) !== null && _k !== void 0 ? _k : "recurring", source: entity.source, plaidStatus: entity.plaid_status, plaidConfidenceLevel: entity.plaid_confidence_level, isHidden: (_l = existing === null || existing === void 0 ? void 0 : existing.isHidden) !== null && _l !== void 0 ? _l : entity.is_hidden, isUserModified: (_m = existing === null || existing === void 0 ? void 0 : existing.isUserModified) !== null && _m !== void 0 ? _m : entity.is_user_modified, transactionIds: entity.transaction_ids, tags: (_o = existing === null || existing === void 0 ? void 0 : existing.tags) !== null && _o !== void 0 ? _o : entity.tags, rules: (_p = existing === null || existing === void 0 ? void 0 : existing.rules) !== null && _p !== void 0 ? _p : entity.rules, 
        // Preserve user remove/pause state across re-sync (Plaid never sets these).
        removedByUser: (_q = existing === null || existing === void 0 ? void 0 : existing.removedByUser) !== null && _q !== void 0 ? _q : false, removalIntervals: (_r = existing === null || existing === void 0 ? void 0 : existing.removalIntervals) !== null && _r !== void 0 ? _r : [] }, ((existing === null || existing === void 0 ? void 0 : existing.manualSettledOccurrences)
        ? { manualSettledOccurrences: existing.manualSettledOccurrences }
        : {})), ((existing === null || existing === void 0 ? void 0 : existing.captureRulesVersion) !== undefined
        ? { captureRulesVersion: existing.captureRulesVersion }
        : !existing && entity.capture_rules_version !== undefined
            ? { captureRulesVersion: entity.capture_rules_version }
            : {})), (entity.plaid_is_active !== undefined
        ? { plaidIsActive: entity.plaid_is_active }
        : (existing === null || existing === void 0 ? void 0 : existing.plaidIsActive) !== undefined
            ? { plaidIsActive: existing.plaidIsActive }
            : {})), ((existing === null || existing === void 0 ? void 0 : existing.plaidInactiveAckAt) ? { plaidInactiveAckAt: existing.plaidInactiveAckAt } : {})), ((existing === null || existing === void 0 ? void 0 : existing.mergedIntoId) ? { mergedIntoId: existing.mergedIntoId } : {})), ((existing === null || existing === void 0 ? void 0 : existing.userFrequency)
        ? { userFrequency: existing.userFrequency }
        : entity.user_frequency
            ? { userFrequency: entity.user_frequency }
            : {})), (0, convert_doc_fields_1.carried_convert_fields)(existing, entity)), { lastSyncedAt: now });
    /* eslint-enable @typescript-eslint/naming-convention */
}
/**
 * Gets Firestore document reference.
 */
function doc_ref(id) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
}
/**
 * Outflow Repository
 *
 * All write operations automatically create audit entries.
 */
exports.outflow_repo = {
    /**
     * Reactivates (un-soft-deletes) the given outflow IDs in batches. The caller
     * decides which IDs to restore; the repo only persists isActive/restoredAt.
     * Returns the number of docs written.
     */
    /** Ids on this account that the account-removal cascade turned off (`deactivatedReason:
     *  "account_removed"`). A outflow the user had already removed is not among them. */
    async get_ids_removed_with_account(_ctx, account_id) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("accountId", "==", account_id)
            .where("deactivatedReason", "==", "account_removed")
            .select()
            .get();
        return snapshot.docs.map((d) => d.id);
    },
    async restore_by_ids(ctx, ids) {
        if (ids.length === 0) {
            return 0;
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        let restored = 0;
        for (const chunk of (0, types_1.chunk_for_batch)(ids)) {
            const batch = db.batch();
            for (const id of chunk) {
                /* eslint-disable @typescript-eslint/naming-convention */
                batch.update(doc_ref(id), {
                    isActive: true,
                    restoredAt: now,
                    deactivatedReason: firestore_1.FieldValue.delete(),
                });
                /* eslint-enable @typescript-eslint/naming-convention */
                restored++;
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] outflow_repo.restore_by_ids: restored=${restored}`);
        return restored;
    },
    /**
     * Persist a user's remove/pause/restore state — the derived `removal_intervals`
     * (source of truth for on-read suppression) + the `removed_by_user` denorm.
     * Preserved across Plaid re-sync by `save_batch`. Records an audit entry.
     */
    async set_removal_intervals(ctx, id, intervals, removed_by_user, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Outflow ${id} not found`);
        }
        const before = before_doc.data();
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const after = Object.assign(Object.assign({}, before), { removedByUser: removed_by_user, removalIntervals: to_removal_interval_docs(intervals), updatedAt: now });
        /* eslint-enable @typescript-eslint/naming-convention */
        // the convert-lifecycle markers are never touched by a full-doc write built from a stale read
        const { data: to_write, merge: as_merge } = (0, convert_doc_fields_1.without_lifecycle_markers)(before, after);
        if (as_merge)
            await doc_ref(id).set(to_write, { merge: true });
        else
            await doc_ref(id).set(after);
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "recurring_outflow",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { operation: "set_removal_intervals" } },
        });
        return (0, types_1.create_write_result)("outflow", id, "replace", before, after);
    },
    /**
     * Sync the outflow's materialized periods' `isActive` to the suppression state.
     * A period whose bucket END falls inside a removal interval → `isActive=false`, so it
     * drops out of `user_summaries` (whose builder queries only `isActive == true`) and
     * therefore out of the live list + totals; otherwise `isActive=true` (restore/reactivate).
     * Only docs whose flag actually changes are written, keeping the summary-recompute
     * fan-out minimal. The durable source of truth stays `removalIntervals` on the def
     * (survives Plaid re-sync); this just keeps the materialized read in step. Returns the
     * number of periods flipped.
     */
    async apply_period_suppression(ctx, id, intervals, user_id, opts = {}) {
        var _a;
        const db = (0, firestore_1.getFirestore)();
        const snap = await db.collection("outflow_periods").where("outflowId", "==", id).get();
        const now = firestore_1.Timestamp.now();
        let flipped = 0;
        let batch = db.batch();
        let batched = 0;
        for (const doc of snap.docs) {
            const p = doc.data();
            const end_ms = (_a = p.periodEndDate) === null || _a === void 0 ? void 0 : _a.toMillis();
            if (end_ms === undefined)
                continue;
            // D27: the derive's month rule (a sub-month period stays active while any of its
            // occurrences is in a month that isn't suppressed) — the picker matches the period page.
            let next_active;
            if (opts.resnap) {
                const d = (0, recurring_suppression_service_1.resnap_period_decision)(intervals, end_ms, (0, recurring_suppression_service_1.stored_occurrence_due_ms)(p), p.isActive !== false);
                if (d.in_window_active && opts.stats)
                    opts.stats.in_window_active++;
                if (!d.flip)
                    continue;
                next_active = d.next_active;
            }
            else {
                next_active = (0, recurring_suppression_service_1.is_stored_period_active)(intervals, end_ms, (0, recurring_suppression_service_1.stored_occurrence_due_ms)(p));
                if ((p.isActive !== false) === next_active)
                    continue; // already in the right state
                // Round 5 test 8: a period turned on by a carried early payment (D28, `carryActive`) is
                // the reconcile's to keep or turn off — turning it off here only for the reconcile to turn
                // it back on was 2 writes on every call.
                if (p.carryActive === true && p.isActive !== false)
                    continue;
            }
            flipped++;
            if (opts.dry_run)
                continue;
            // The one-off re-snap writes ONLY the flag (`touch_updated_at: false`).
            // eslint-disable-next-line @typescript-eslint/naming-convention
            batch.update(doc.ref, opts.touch_updated_at === false ? { isActive: next_active } : { isActive: next_active, updatedAt: now });
            if (++batched >= 450) {
                await batch.commit();
                batch = db.batch();
                batched = 0;
            }
        }
        if (batched > 0)
            await batch.commit();
        console.log(`[${ctx.trace_id}] outflow_repo.apply_period_suppression ${id}: ${opts.dry_run ? "would flip" : "flipped"} ${flipped}/${snap.size} periods (user ${user_id})`);
        return flipped;
    },
    /**
     * Set ("Mark as paid") or clear (null) ONE occurrence's manual mark, keyed by its UTC
     * due date `YYYY-MM-DD`, in a transaction. Only the `set_occurrence_settled` orchestrator
     * calls this. Records an audit entry.
     */
    async set_manual_settlement(ctx, id, date_key, mark, user_id) {
        const { before, after } = await (0, manual_settlement_doc_1.write_manual_settlement)(COLLECTION, id, date_key, mark);
        /* eslint-disable @typescript-eslint/naming-convention */
        const before_part = { manualSettledOccurrences: before };
        const after_part = { manualSettledOccurrences: after };
        /* eslint-enable @typescript-eslint/naming-convention */
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "recurring_outflow",
            entity_id: id,
            before: before_part,
            after: after_part,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { operation: "set_manual_settlement", date_key } },
        });
        return (0, types_1.create_write_result)("outflow", id, "merge", before_part, after_part);
    },
    /**
     * Delete every stored period of an outflow (its own aggregate) — the "Delete permanently" path,
     * before the doc itself: a period left behind stays a match candidate and shows in the summaries.
     */
    async delete_periods(ctx, id, user_id) {
        const db = (0, firestore_1.getFirestore)();
        const snap = await db.collection("outflow_periods").where("outflowId", "==", id).select().get();
        for (let i = 0; i < snap.docs.length; i += 450) {
            const batch = db.batch();
            for (const d of snap.docs.slice(i, i + 450))
                batch.delete(d.ref);
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] outflow_repo.delete_periods ${id}: deleted ${snap.size} periods (user ${user_id})`);
        return snap.size;
    },
    /**
     * Permanently delete an outflow doc — irreversible ("Delete permanently").
     */
    async hard_delete(ctx, id, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Outflow ${id} not found`);
        }
        const before = before_doc.data();
        await doc_ref(id).delete();
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "delete",
            entity_type: "recurring_outflow",
            entity_id: id,
            before: before,
            after: null,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { operation: "hard_delete" } },
        });
        return (0, types_1.create_write_result)("outflow", id, "replace", before, null);
    },
    /**
     * Gets an outflow by ID.
     */
    async get_by_id(_ctx, id, options) {
        const doc = await doc_ref(id).get();
        if (!doc.exists) {
            return null;
        }
        const data = doc.data();
        if (!data.isActive && !(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            return null;
        }
        return map_to_entity(data);
    },
    /**
     * Gets all outflows for a user.
     */
    async get_by_user_id(_ctx, user_id, options) {
        var _a;
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("ownerId", "==", user_id);
        if (!(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            query = query.where("isActive", "==", true);
        }
        if (options === null || options === void 0 ? void 0 : options.order_by) {
            query = query.orderBy(options.order_by, (_a = options.order_direction) !== null && _a !== void 0 ? _a : "asc");
        }
        if (options === null || options === void 0 ? void 0 : options.limit) {
            query = query.limit(options.limit);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc) => map_to_entity(doc.data()));
    },
    /**
     * Gets outflows by Plaid item ID.
     */
    async get_by_plaid_item_id(_ctx, plaid_item_id, options) {
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("plaidItemId", "==", plaid_item_id);
        if (!(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc) => map_to_entity(doc.data()));
    },
    /**
     * Gets outflows by account ID.
     *
     * Used by resolvers to find recurring outflows linked to a specific account
     * for cascade operations (e.g., account removal).
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param options - Read options
     * @returns Array of outflow entities linked to this account
     */
    async get_by_account_id(ctx, account_id, options) {
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("accountId", "==", account_id);
        if (!(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query.get();
        const outflows = snapshot.docs.map((doc) => map_to_entity(doc.data()));
        console.log(`[${ctx.trace_id}] get_by_account_id: account=${account_id}, found=${outflows.length}`);
        return outflows;
    },
    /**
     * Finds an outflow by Plaid stream ID.
     *
     * Since stream_id is used as the document ID, this is a direct lookup.
     */
    async find_by_plaid_stream_id(ctx, plaid_stream_id) {
        return this.get_by_id(ctx, plaid_stream_id);
    },
    /**
     * Finds all outflows by multiple Plaid stream IDs.
     *
     * Returns a Map for efficient lookup.
     */
    async find_by_plaid_stream_ids(_ctx, plaid_stream_ids) {
        const result = new Map();
        if (plaid_stream_ids.length === 0) {
            return result;
        }
        // Firestore 'in' queries limited to 30 items
        const chunks = (0, types_1.chunk_for_batch)(plaid_stream_ids, 30);
        for (const chunk of chunks) {
            const db = (0, firestore_1.getFirestore)();
            const snapshot = await db
                .collection(COLLECTION)
                .where("__name__", "in", chunk)
                .get();
            for (const doc of snapshot.docs) {
                const data = doc.data();
                result.set(doc.id, map_to_entity(data));
            }
        }
        return result;
    },
    /** Map a raw stored doc (from `get_raw_by_ids`) to the entity — no read. */
    entity_from_raw(raw) {
        return map_to_entity(raw);
    },
    /**
     * The stored docs (raw camelCase, ANY state — active, inactive, stale) for the given ids, ONE
     * batched read. Missing ids are absent from the map. The recurring sync prefetches with this and
     * hands the map to `save_batch` (which then skips its own identical read).
     */
    async get_raw_by_ids(_ctx, ids) {
        const out = new Map();
        const db = (0, firestore_1.getFirestore)();
        for (const chunk of (0, types_1.chunk_for_batch)([...new Set(ids)])) {
            if (chunk.length === 0)
                continue;
            const snaps = await db.getAll(...chunk.map((id) => doc_ref(id)));
            for (const snap of snaps) {
                if (snap.exists)
                    out.set(snap.id, snap.data());
            }
        }
        return out;
    },
    /** A user's INACTIVE records (stopped / stale / soft-deleted) — loaded lazily by the capture
     *  planner only when a new v2 stream needs a same-bill candidate (X9). */
    /**
     * ACTIVE records that carry removal intervals (the D27 one-off re-snap's input): id, owner and
     * intervals only (`select`). All users unless `user_id`. Read-only.
     */
    async list_active_with_removal_intervals(_ctx, user_id) {
        let q = (0, firestore_1.getFirestore)().collection(COLLECTION).where("isActive", "==", true);
        if (user_id)
            q = q.where("ownerId", "==", user_id);
        const snap = await q.select("ownerId", "removalIntervals", "captureRulesVersion").get();
        return snap.docs
            .map((d) => {
            var _a, _b;
            return ({
                id: d.id,
                owner_id: String((_a = d.get("ownerId")) !== null && _a !== void 0 ? _a : ""),
                v2: d.get("captureRulesVersion") === 2,
                removal_intervals: ((_b = d.get("removalIntervals")) !== null && _b !== void 0 ? _b : [])
                    .map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })),
            });
        })
            .filter((r) => r.removal_intervals.length > 0);
    },
    async get_inactive_by_user_id(_ctx, user_id) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("ownerId", "==", user_id)
            .where("isActive", "==", false)
            .get();
        return snapshot.docs.map((doc) => map_to_entity(doc.data()));
    },
    /**
     * Record Plaid's opinion on v2 records Plaid stopped returning (D19: they are not stale-marked;
     * the user is asked "Still a bill?"). Writes only docs whose value changes. Stamped with the
     * sync run so the recurring trigger leaves the bump to the sync.
     */
    async set_plaid_is_active(ctx, ids, value, user_id, run_id) {
        var _a;
        if (ids.length === 0)
            return 0;
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        let written = 0;
        for (const chunk of (0, types_1.chunk_for_batch)(ids)) {
            const snaps = await db.getAll(...chunk.map((id) => doc_ref(id)));
            const batch = db.batch();
            let n = 0;
            for (const snap of snaps) {
                if (!snap.exists)
                    continue;
                const before = snap.data();
                if (before.plaidIsActive === value)
                    continue;
                /* eslint-disable @typescript-eslint/naming-convention */
                const patch = { plaidIsActive: value, updatedAt: now };
                if (run_id) {
                    patch.syncRunId = run_id;
                    patch.lastWriteSource = "plaid_sync";
                }
                /* eslint-enable @typescript-eslint/naming-convention */
                batch.update(snap.ref, patch);
                n++;
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "update",
                    entity_type: "recurring_outflow",
                    entity_id: snap.id,
                    before: { plaidIsActive: (_a = before.plaidIsActive) !== null && _a !== void 0 ? _a : null },
                    after: { plaidIsActive: value },
                    trace_id: ctx.trace_id,
                    metadata: { source: "api", context: { reason: "plaid_inactive_v2" } },
                });
            }
            if (n > 0)
                await batch.commit();
            written += n;
        }
        return written;
    },
    /** "Still a bill" answer on a v2 record: remember it (preserved across syncs) so it isn't asked again. */
    async set_plaid_inactive_ack(ctx, id, ack_ms, user_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            plaidInactiveAckAt: firestore_1.Timestamp.fromMillis(ack_ms),
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "recurring_outflow",
            entity_id: id,
            before: null,
            after: { plaidInactiveAckAt: ack_ms },
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { operation: "still_a_bill" } },
        });
    },
    /**
     * Saves a batch of outflows with upsert logic.
     *
     * For each outflow:
     * - If exists: update with Plaid data, preserve user modifications
     * - If new: create with pending_review status
     */
    async save_batch(ctx, entities, 
    /** Sync run writing these: stamped as `syncRunId` so the recurring triggers leave the
     *  period generation + reconcile to the sync (it does them once, inline). */
    run_id, 
    /** The stored docs for `entities` ids, already read by the caller (`get_raw_by_ids`) — a
     *  missing key means "doesn't exist". When given, this skips the read below, so the sync's
     *  read count is unchanged by the prefetch. */
    prefetched) {
        if (entities.length === 0) {
            return { results: [], count: 0, success: true, written: [] };
        }
        const written = [];
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        // Get existing documents for upsert logic — ONE batched read of the raw docs (was an
        // `in` query for existence PLUS a per-doc `.get()` for the data: 2 reads per stream).
        const existing_docs = new Map();
        if (prefetched) {
            for (const [id, d] of prefetched)
                existing_docs.set(id, d);
        }
        else {
            for (const ids of (0, types_1.chunk_for_batch)(entities.map((e) => e.id))) {
                const snaps = await db.getAll(...ids.map((id) => doc_ref(id)));
                for (const snap of snaps) {
                    if (snap.exists)
                        existing_docs.set(snap.id, snap.data());
                }
            }
        }
        // Process in batches. The prefetched copy only decides which streams changed (most don't);
        // the ones to write are RE-READ inside a transaction and rebuilt from that read, so a user
        // edit made while the sync ran (expected amount, Mark as paid, rename, remove) is kept, never
        // reverted to the earlier copy. A concurrent edit makes the transaction retry with fresh data
        // (Code-Health-Review M4-H1).
        const chunks = (0, types_1.chunk_for_batch)(entities);
        let unchanged = 0;
        for (const chunk of chunks) {
            const candidates = chunk.filter((entity) => {
                var _a;
                const prior = (_a = existing_docs.get(entity.id)) !== null && _a !== void 0 ? _a : null;
                return !(prior && (0, recurring_doc_equality_1.is_unchanged_recurring_doc)(prior, map_persistence_to_doc(entity, now, prior)));
            });
            unchanged += chunk.length - candidates.length;
            if (candidates.length === 0)
                continue;
            const committed = await db.runTransaction(async (tx) => {
                const snaps = await tx.getAll(...candidates.map((e) => doc_ref(e.id)));
                const out = [];
                candidates.forEach((entity, i) => {
                    const existing_doc = snaps[i].exists ? snaps[i].data() : null;
                    const doc_data = map_persistence_to_doc(entity, now, existing_doc);
                    // Skip a no-op rewrite (only the sync timestamps would change) — avoids a
                    // pointless on_recurring_updated fan-out + derive-cache invalidation per stream.
                    if (existing_doc && (0, recurring_doc_equality_1.is_unchanged_recurring_doc)(existing_doc, doc_data))
                        return;
                    const stamped = (run_id
                        ? Object.assign(Object.assign({}, doc_data), { syncRunId: run_id, lastWriteSource: "plaid_sync" }) : doc_data);
                    const { data: to_write, merge: as_merge } = (0, convert_doc_fields_1.without_lifecycle_markers)(existing_doc, stamped);
                    if (as_merge)
                        tx.set(doc_ref(entity.id), to_write, { merge: true });
                    else
                        tx.set(doc_ref(entity.id), stamped);
                    out.push({ entity, existing_doc, doc_data, stamped });
                });
                return out;
            });
            unchanged += candidates.length - committed.length;
            for (const { entity, existing_doc, doc_data, stamped } of committed) {
                const existing = existing_doc !== null;
                written.push({
                    id: entity.id,
                    kind: "outflow",
                    created: !existing,
                    before: existing_doc,
                    after: stamped,
                });
                results.push((0, types_1.create_write_result)("outflow", entity.id, existing ? "replace" : "replace", existing_doc, doc_data));
                // Audit entry (async)
                (0, audit_1.record_audit_entry_async)({
                    user_id: entity.owner_id,
                    action: existing ? "update" : "create",
                    entity_type: "recurring_outflow",
                    entity_id: entity.id,
                    before: existing_doc,
                    after: doc_data,
                    trace_id: ctx.trace_id,
                    metadata: { source: "api" },
                });
            }
        }
        console.log(`[${ctx.trace_id}] outflow_repo.save_batch: saved=${results.length} unchanged=${unchanged}`);
        return {
            results,
            count: entities.length,
            success: true,
            written,
        };
    },
    /**
     * A brand-new outflow document (and its ref), built by the SAME mapper `save_batch` uses, for a
     * caller that creates it inside its own Firestore transaction (Convert-To-Recurring: the record
     * and the converted split's pin land together). Stamped with the creator's run id so the
     * create / update triggers skip it — the creator generates the periods and runs the single
     * follow-up itself.
     */
    build_new_doc(entity, run_id) {
        const doc = map_persistence_to_doc(entity, firestore_1.Timestamp.now(), null);
        /* eslint-disable @typescript-eslint/naming-convention */
        return {
            ref: doc_ref(entity.id),
            data: Object.assign(Object.assign({}, doc), { syncRunId: run_id, lastWriteSource: "convert" }),
        };
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Record what an absorb changed on a converted outflow (D42): its absorbed streams and their payment
     * ids — nothing else, never Plaid's numbers. Stamped with the sync run so the update trigger
     * neither bumps nor reconciles (the sync does both once).
     */
    async record_absorbed(_ctx, id, streams, txn_ids, run_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            absorbedStreams: (0, convert_doc_fields_1.absorbed_streams_to_doc)(streams),
            absorbedTxnIds: txn_ids,
            syncRunId: run_id,
            lastWriteSource: "plaid_sync",
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Apply a same-bill merge to the OLD outflow in ONE stamped write: its end interval, `mergedIntoId`,
     * `mergeLog`, and active again (its history keeps showing). The caller flips the stored periods
     * (`apply_period_suppression`) and bumps after.
     */
    async apply_merge(_ctx, id, plan, run_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            removalIntervals: to_removal_interval_docs(plan.intervals),
            removedByUser: plan.intervals.some((i) => i.to_ms === null),
            mergedIntoId: plan.merged_into_id,
            mergeLog: (0, convert_doc_fields_1.merge_log_to_doc)(plan.merge_log),
            isActive: true,
            syncRunId: run_id,
            lastWriteSource: "merge",
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /** Undo a merge on the OLD outflow: its intervals back, the merge fields gone. One stamped write. */
    async clear_merge(_ctx, id, intervals, run_id, prior_is_active) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update(Object.assign(Object.assign({}, (prior_is_active !== undefined ? { isActive: prior_is_active } : {})), { removalIntervals: to_removal_interval_docs(intervals), removedByUser: intervals.some((i) => i.to_ms === null), mergedIntoId: firestore_1.FieldValue.delete(), mergeLog: firestore_1.FieldValue.delete(), syncRunId: run_id, lastWriteSource: "merge", updatedAt: firestore_1.Timestamp.now() }));
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /** The user's outflows merged into `into_id` (a delete of the target unmerges them). */
    async get_merged_into(_ctx, user_id, into_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(COLLECTION).where("ownerId", "==", user_id).where("mergedIntoId", "==", into_id).select().get();
        return snap.docs.map((d) => ({ id: d.id }));
    },
    /** Reset the inherited name / override on the NEW outflow (undo). Stamped. */
    async revert_inherited(_ctx, id, fields, run_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update(Object.assign(Object.assign(Object.assign({}, (fields.name ? { userCustomName: null } : {})), (fields.override ? { expectedAmountOverride: null } : {})), { syncRunId: run_id, lastWriteSource: "merge", updatedAt: firestore_1.Timestamp.now() }));
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Claim the right to RESUME a died convert: one resume at a time (a lease of 330 s: longer than the callable's 300 s timeout; it expires, so a died resume can be retried), so a
     * concurrent double tap returns the bill instead of repeating the work. Stamped.
     */
    async claim_resume(_ctx, id, now_ms) {
        return (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a, _b, _c;
            const snap = await tx.get(doc_ref(id));
            const lease = (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.resumeLeaseMs) !== null && _b !== void 0 ? _b : 0;
            if (!snap.exists || lease > now_ms)
                return false;
            const attempts = (_c = snap.data().convertAttempts) !== null && _c !== void 0 ? _c : 1;
            if (attempts >= MAX_CONVERT_ATTEMPTS) {
                throw new types_1.ConvertRefusedError("CONVERT_FAILED", "This couldn't be finished. Delete it from your bills, then tap \"Make this a bill\" again.");
            }
            /* eslint-disable @typescript-eslint/naming-convention */
            tx.update(doc_ref(id), { convertAttempts: attempts + 1, resumeLeaseMs: now_ms + 330000, syncRunId: `resume_lease_${now_ms}`, lastWriteSource: "convert" });
            /* eslint-enable @typescript-eslint/naming-convention */
            return true;
        });
    },
    /** Does this outflow have any stored period? (A resumed convert generates them only when none exist.) */
    async has_periods(_ctx, id) {
        const snap = await (0, firestore_1.getFirestore)().collection("outflow_periods").where("outflowId", "==", id).limit(1).select().get();
        return !snap.empty;
    },
    /** The convert's periods + follow-up pass finished: a resume may skip them. Stamped (no trigger fan-out). */
    async mark_follow_ups_done(_ctx, id, at_ms, run_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({ followUpsDoneAtMs: at_ms, syncRunId: run_id, lastWriteSource: "convert", updatedAt: firestore_1.Timestamp.now() });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /** Give the resume lease back (a convert that could not finish: the next tap resumes at once). */
    async release_resume_lease(_ctx, id, run_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({ resumeLeaseMs: 0, syncRunId: run_id, lastWriteSource: "convert" });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Stamp "the convert's retro-link finished" on a converted record. Stamped with the creator's run
     * id so the update trigger leaves the bump to the creator (no second bump, no reconcile).
     */
    async mark_retro_linked(_ctx, id, at_ms, run_id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            retroLinkedAtMs: at_ms,
            syncRunId: run_id,
            lastWriteSource: "convert",
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Soft-deletes an outflow.
     */
    async soft_delete(ctx, id, user_id, 
    /** Why it was turned off. "account_removed" marks it so restoring the account brings back
     *  exactly what the removal turned off (Code-Health-Review P1-H1). */
    reason) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Outflow ${id} not found`);
        }
        const before = before_doc.data();
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const after = Object.assign(Object.assign(Object.assign({}, before), { isActive: false, updatedAt: now }), (reason ? { deactivatedReason: reason } : {}));
        /* eslint-enable @typescript-eslint/naming-convention */
        // the convert-lifecycle markers are never touched by a full-doc write built from a stale read
        const { data: to_write, merge: as_merge } = (0, convert_doc_fields_1.without_lifecycle_markers)(before, after);
        if (as_merge)
            await doc_ref(id).set(to_write, { merge: true });
        else
            await doc_ref(id).set(after);
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "delete",
            entity_type: "recurring_outflow",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("outflow", id, "replace", before, after);
    },
    /**
     * Marks outflows as inactive when Plaid no longer reports them.
     */
    async mark_stale(ctx, stream_ids, user_id) {
        if (stream_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(stream_ids);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const id of chunk) {
                const before_doc = await doc_ref(id).get();
                if (!before_doc.exists)
                    continue;
                const before = before_doc.data();
                /* eslint-disable @typescript-eslint/naming-convention */
                const after = Object.assign(Object.assign({}, before), { isActive: false, plaidStatus: "STALE", updatedAt: now });
                /* eslint-enable @typescript-eslint/naming-convention */
                // the convert-lifecycle markers are never touched by a full-doc write built from a stale read
                const { data: to_write, merge: as_merge } = (0, convert_doc_fields_1.without_lifecycle_markers)(before, after);
                if (as_merge)
                    batch.set(doc_ref(id), to_write, { merge: true });
                else
                    batch.set(doc_ref(id), after);
                results.push((0, types_1.create_write_result)("outflow", id, "replace", before, after));
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "update",
                    entity_type: "recurring_outflow",
                    entity_id: id,
                    before: before,
                    after: after,
                    trace_id: ctx.trace_id,
                    metadata: { source: "api", context: { reason: "marked_stale" } },
                });
            }
            await batch.commit();
        }
        return results;
    },
    /**
     * Mark recurring outflows as HIDDEN (durable exclusion of internal account
     * transfers). `isHidden` is preserved by `save_batch` across re-syncs, so once
     * set it survives Plaid recreating the stream. Idempotent.
     */
    async mark_hidden(ctx, stream_ids, hidden, user_id) {
        if (stream_ids.length === 0) {
            return [];
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        for (const chunk of (0, types_1.chunk_for_batch)(stream_ids)) {
            const batch = db.batch();
            for (const id of chunk) {
                const before_doc = await doc_ref(id).get();
                if (!before_doc.exists)
                    continue;
                const before = before_doc.data();
                if (before.isHidden === hidden)
                    continue; // idempotent
                // eslint-disable-next-line @typescript-eslint/naming-convention
                const after = Object.assign(Object.assign({}, before), { isHidden: hidden, updatedAt: now });
                // the convert-lifecycle markers are never touched by a full-doc write built from a stale read
                const { data: to_write, merge: as_merge } = (0, convert_doc_fields_1.without_lifecycle_markers)(before, after);
                if (as_merge)
                    batch.set(doc_ref(id), to_write, { merge: true });
                else
                    batch.set(doc_ref(id), after);
                results.push((0, types_1.create_write_result)("outflow", id, "replace", before, after));
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "update",
                    entity_type: "recurring_outflow",
                    entity_id: id,
                    before: before,
                    after: after,
                    trace_id: ctx.trace_id,
                    metadata: { source: "api", context: { reason: "internal_transfer_hidden" } },
                });
            }
            await batch.commit();
        }
        return results;
    },
};
//# sourceMappingURL=outflow.repo.js.map