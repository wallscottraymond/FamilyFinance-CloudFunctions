"use strict";
/**
 * Inflow Repository
 *
 * Handles persistence for recurring income (inflows).
 * Supports Plaid sync with upsert logic.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/inflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inflow_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "inflows";
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * Maps legacy Firestore document to Inflow entity.
 */
function map_to_entity(doc) {
    var _a, _b, _c, _d, _e;
    return {
        id: doc.id,
        user_id: doc.ownerId,
        group_ids: (_a = doc.groupIds) !== null && _a !== void 0 ? _a : (doc.groupId ? [doc.groupId] : []),
        is_active: doc.isActive,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
        plaid_item_id: doc.plaidItemId,
        plaid_stream_id: doc.id, // stream_id is the document ID
        account_id: doc.accountId,
        last_amount: doc.lastAmount,
        average_amount: doc.averageAmount,
        amount_min: undefined, // Legacy docs may not have this
        amount_max: undefined,
        currency: doc.currency,
        description: doc.description,
        payer_name: doc.merchantName,
        user_custom_name: doc.userCustomName,
        frequency: doc.frequency,
        first_date: doc.firstDate,
        last_date: doc.lastDate,
        predicted_next_date: doc.predictedNextDate,
        plaid_primary_category: doc.plaidPrimaryCategory,
        plaid_detailed_category: doc.plaidDetailedCategory,
        internal_primary_category: doc.internalPrimaryCategory,
        internal_detailed_category: doc.internalDetailedCategory,
        income_type: (_b = doc.incomeType) !== null && _b !== void 0 ? _b : "other",
        is_regular_salary: (_c = doc.isRegularSalary) !== null && _c !== void 0 ? _c : false,
        is_variable: false,
        status: "active",
        source: doc.source,
        plaid_status: (_d = doc.plaidStatus) !== null && _d !== void 0 ? _d : "UNKNOWN",
        plaid_confidence_level: (_e = doc.plaidConfidenceLevel) !== null && _e !== void 0 ? _e : null,
        is_hidden: doc.isHidden,
        is_user_modified: doc.isUserModified,
        transaction_ids: doc.transactionIds,
        tags: doc.tags,
        rules: doc.rules,
        last_synced_at: doc.lastSyncedAt,
    };
}
/**
 * Maps InflowForPersistence to legacy Firestore document.
 */
function map_persistence_to_doc(entity, now, existing) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        id: entity.id,
        ownerId: entity.owner_id,
        createdBy: entity.created_by,
        updatedBy: entity.updated_by,
        groupId: (_a = entity.group_ids[0]) !== null && _a !== void 0 ? _a : null,
        groupIds: entity.group_ids,
        isActive: entity.is_active,
        createdAt: (_b = existing === null || existing === void 0 ? void 0 : existing.createdAt) !== null && _b !== void 0 ? _b : now,
        updatedAt: now,
        plaidItemId: entity.plaid_item_id,
        accountId: entity.account_id,
        lastAmount: entity.last_amount,
        averageAmount: entity.average_amount,
        currency: entity.currency,
        description: entity.description,
        merchantName: entity.payer_name,
        userCustomName: (_c = existing === null || existing === void 0 ? void 0 : existing.userCustomName) !== null && _c !== void 0 ? _c : entity.user_custom_name,
        frequency: entity.frequency,
        firstDate: firestore_1.Timestamp.fromDate(entity.first_date),
        lastDate: firestore_1.Timestamp.fromDate(entity.last_date),
        predictedNextDate: entity.predicted_next_date
            ? firestore_1.Timestamp.fromDate(entity.predicted_next_date)
            : null,
        plaidPrimaryCategory: entity.plaid_primary_category,
        plaidDetailedCategory: entity.plaid_detailed_category,
        internalPrimaryCategory: (_d = existing === null || existing === void 0 ? void 0 : existing.internalPrimaryCategory) !== null && _d !== void 0 ? _d : entity.internal_primary_category,
        internalDetailedCategory: (_e = existing === null || existing === void 0 ? void 0 : existing.internalDetailedCategory) !== null && _e !== void 0 ? _e : entity.internal_detailed_category,
        incomeType: entity.income_type,
        isRegularSalary: entity.is_regular_salary,
        source: entity.source,
        plaidStatus: entity.plaid_status,
        plaidConfidenceLevel: entity.plaid_confidence_level,
        isHidden: (_f = existing === null || existing === void 0 ? void 0 : existing.isHidden) !== null && _f !== void 0 ? _f : entity.is_hidden,
        isUserModified: (_g = existing === null || existing === void 0 ? void 0 : existing.isUserModified) !== null && _g !== void 0 ? _g : entity.is_user_modified,
        transactionIds: entity.transaction_ids,
        tags: (_h = existing === null || existing === void 0 ? void 0 : existing.tags) !== null && _h !== void 0 ? _h : entity.tags,
        rules: (_j = existing === null || existing === void 0 ? void 0 : existing.rules) !== null && _j !== void 0 ? _j : entity.rules,
        lastSyncedAt: now,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
/**
 * Gets Firestore document reference.
 */
function doc_ref(id) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
}
/**
 * Inflow Repository
 *
 * All write operations automatically create audit entries.
 */
exports.inflow_repo = {
    /**
     * Reactivates (un-soft-deletes) the given inflow IDs in batches. The caller
     * decides which IDs to restore; the repo only persists isActive/restoredAt.
     * Returns the number of docs written.
     */
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
                batch.update(doc_ref(id), { isActive: true, restoredAt: now });
                /* eslint-enable @typescript-eslint/naming-convention */
                restored++;
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] inflow_repo.restore_by_ids: restored=${restored}`);
        return restored;
    },
    /**
     * Gets an inflow by ID.
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
     * Gets all inflows for a user.
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
     * Gets inflows by Plaid item ID.
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
     * Gets inflows by account ID.
     *
     * Used by resolvers to find recurring inflows linked to a specific account
     * for cascade operations (e.g., account removal).
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param options - Read options
     * @returns Array of inflow entities linked to this account
     */
    async get_by_account_id(ctx, account_id, options) {
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("accountId", "==", account_id);
        if (!(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query.get();
        const inflows = snapshot.docs.map((doc) => map_to_entity(doc.data()));
        console.log(`[${ctx.trace_id}] get_by_account_id: account=${account_id}, found=${inflows.length}`);
        return inflows;
    },
    /**
     * Finds an inflow by Plaid stream ID.
     *
     * Since stream_id is used as the document ID, this is a direct lookup.
     */
    async find_by_plaid_stream_id(ctx, plaid_stream_id) {
        return this.get_by_id(ctx, plaid_stream_id);
    },
    /**
     * Finds all inflows by multiple Plaid stream IDs.
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
    /**
     * Saves a batch of inflows with upsert logic.
     *
     * For each inflow:
     * - If exists: update with Plaid data, preserve user modifications
     * - If new: create with pending_review status
     */
    async save_batch(ctx, entities) {
        if (entities.length === 0) {
            return { results: [], count: 0, success: true };
        }
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const results = [];
        // Get existing documents for upsert logic
        const stream_ids = entities.map((e) => e.id);
        const existing_map = await this.find_by_plaid_stream_ids(ctx, stream_ids);
        // Process in batches
        const chunks = (0, types_1.chunk_for_batch)(entities);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const entity of chunk) {
                const existing = existing_map.get(entity.id);
                const existing_doc = existing
                    ? (await doc_ref(entity.id).get()).data()
                    : null;
                const doc_data = map_persistence_to_doc(entity, now, existing_doc);
                batch.set(doc_ref(entity.id), doc_data);
                results.push((0, types_1.create_write_result)("inflow", entity.id, existing ? "replace" : "replace", existing_doc, doc_data));
                // Audit entry (async)
                (0, audit_1.record_audit_entry_async)({
                    user_id: entity.owner_id,
                    action: existing ? "update" : "create",
                    entity_type: "recurring_inflow",
                    entity_id: entity.id,
                    before: existing_doc,
                    after: doc_data,
                    trace_id: ctx.trace_id,
                    metadata: { source: "api" },
                });
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] inflow_repo.save_batch: saved=${results.length}`);
        return {
            results,
            count: entities.length,
            success: true,
        };
    },
    /**
     * Soft-deletes an inflow.
     */
    async soft_delete(ctx, id, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Inflow ${id} not found`);
        }
        const before = before_doc.data();
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const after = Object.assign(Object.assign({}, before), { isActive: false, updatedAt: now });
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).set(after);
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "delete",
            entity_type: "recurring_inflow",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("inflow", id, "replace", before, after);
    },
    /**
     * Marks inflows as inactive when Plaid no longer reports them.
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
                batch.set(doc_ref(id), after);
                results.push((0, types_1.create_write_result)("inflow", id, "replace", before, after));
                (0, audit_1.record_audit_entry_async)({
                    user_id,
                    action: "update",
                    entity_type: "recurring_inflow",
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
};
//# sourceMappingURL=inflow.repo.js.map