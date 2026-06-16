"use strict";
/**
 * Account Repository
 *
 * Handles persistence for account entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.account_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const audit_1 = require("../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "accounts";
/**
 * Maps legacy Firestore document to Account entity.
 */
function map_to_entity(doc) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
        id: doc.id,
        user_id: doc.userId,
        group_ids: (_a = doc.groupIds) !== null && _a !== void 0 ? _a : [],
        is_active: doc.isActive,
        is_deleted: doc.isDeleted,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
        account_id: doc.accountId,
        item_id: doc.itemId,
        name: (_c = (_b = doc.name) !== null && _b !== void 0 ? _b : doc.accountName) !== null && _c !== void 0 ? _c : "",
        mask: doc.mask,
        official_name: doc.officialName,
        account_type: doc.accountType,
        account_subtype: doc.accountSubtype,
        balances: {
            current: doc.currentBalance,
            available: doc.availableBalance,
            limit: doc.limit,
            iso_currency_code: doc.isoCurrencyCode,
            last_updated: (_d = doc.lastBalanceUpdate) !== null && _d !== void 0 ? _d : doc.updatedAt,
        },
        institution: {
            id: doc.institutionId,
            name: doc.institutionName,
        },
        is_sync_enabled: (_e = doc.isSyncEnabled) !== null && _e !== void 0 ? _e : true,
        last_synced_at: doc.lastSyncedAt,
        access: doc.access
            ? {
                owner_id: doc.access.ownerId,
                created_by: doc.access.createdBy,
                group_ids: doc.access.groupIds,
                is_private: doc.access.isPrivate,
            }
            : {
                owner_id: doc.userId,
                created_by: doc.userId,
                group_ids: (_f = doc.groupIds) !== null && _f !== void 0 ? _f : [],
                is_private: ((_g = doc.groupIds) !== null && _g !== void 0 ? _g : []).length === 0,
            },
    };
}
/**
 * Maps Account entity to legacy Firestore document.
 */
function map_to_doc(entity) {
    return {
        id: entity.id,
        userId: entity.user_id,
        groupIds: entity.group_ids,
        isActive: entity.is_active,
        isDeleted: entity.is_deleted,
        createdAt: entity.created_at,
        updatedAt: entity.updated_at,
        accountId: entity.account_id,
        itemId: entity.item_id,
        name: entity.name,
        accountName: entity.name,
        mask: entity.mask,
        officialName: entity.official_name,
        accountType: entity.account_type,
        accountSubtype: entity.account_subtype,
        currentBalance: entity.balances.current,
        availableBalance: entity.balances.available,
        limit: entity.balances.limit,
        isoCurrencyCode: entity.balances.iso_currency_code,
        lastBalanceUpdate: entity.balances.last_updated,
        institutionId: entity.institution.id,
        institutionName: entity.institution.name,
        isSyncEnabled: entity.is_sync_enabled,
        lastSyncedAt: entity.last_synced_at,
        access: {
            ownerId: entity.access.owner_id,
            createdBy: entity.access.created_by,
            groupIds: entity.access.group_ids,
            isPrivate: entity.access.is_private,
        },
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
 * Account Repository
 *
 * All write operations automatically create audit entries.
 */
exports.account_repo = {
    /**
     * Gets an account by ID.
     *
     * @param _ctx - Trace context (for future observability)
     * @param id - Account ID
     * @param options - Read options
     * @returns Account entity or null if not found
     */
    async get_by_id(_ctx, id, options) {
        const doc = await doc_ref(id).get();
        if (!doc.exists) {
            return null;
        }
        const data = doc.data();
        // Filter deleted unless requested
        if (data.isDeleted && !(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            return null;
        }
        return map_to_entity(data);
    },
    /**
     * Gets all accounts for a user.
     *
     * @param _ctx - Trace context
     * @param user_id - User ID
     * @param options - Read options
     * @returns Array of account entities
     */
    async get_by_user_id(_ctx, user_id, options) {
        var _a;
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("userId", "==", user_id);
        // Filter deleted unless requested
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
     * Gets accounts by item ID (all accounts linked to a Plaid item).
     *
     * @param _ctx - Trace context
     * @param item_id - Plaid item ID
     * @param options - Read options
     * @returns Array of account entities
     */
    async get_by_item_id(_ctx, item_id, options) {
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("itemId", "==", item_id);
        if (!(options === null || options === void 0 ? void 0 : options.include_deleted)) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc) => map_to_entity(doc.data()));
    },
    /**
     * Saves an account (create or update).
     *
     * @param ctx - Trace context
     * @param entity - Account entity to save
     * @returns Write result
     */
    async save(ctx, entity) {
        // Structural validation
        if (!entity.id) {
            throw new Error("Account ID is required");
        }
        if (!entity.user_id) {
            throw new Error("User ID is required");
        }
        // Get before state for audit
        const before_doc = await doc_ref(entity.id).get();
        const before = before_doc.exists ? before_doc.data() : null;
        // Ensure updated_at is set
        const entity_to_save = Object.assign(Object.assign({}, entity), { updated_at: firestore_1.Timestamp.now() });
        // Convert to legacy format and save
        const doc_data = map_to_doc(entity_to_save);
        await doc_ref(entity.id).set(doc_data);
        // Create audit entry (async, non-blocking)
        (0, audit_1.record_audit_entry_async)({
            user_id: entity.user_id,
            action: before ? "update" : "create",
            entity_type: "account",
            entity_id: entity.id,
            before: before,
            after: doc_data,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("account", entity.id, "replace", before, doc_data);
    },
    /**
     * Saves multiple accounts in a batch.
     *
     * @param ctx - Trace context
     * @param entities - Account entities to save
     * @returns Batch write result
     */
    async save_batch(ctx, entities) {
        var _a;
        if (entities.length === 0) {
            return { results: [], count: 0, success: true };
        }
        const db = (0, firestore_1.getFirestore)();
        const results = [];
        const chunks = (0, types_1.chunk_for_batch)(entities);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const entity of chunk) {
                if (!entity.id) {
                    throw new Error("Account ID is required");
                }
            }
            // Read all before-states for the chunk in a single round-trip (getAll)
            // instead of one awaited .get() per entity inside the loop.
            const before_docs = await db.getAll(...chunk.map((entity) => doc_ref(entity.id)));
            const before_states = new Map();
            chunk.forEach((entity, i) => {
                const before_doc = before_docs[i];
                before_states.set(entity.id, before_doc.exists ? before_doc.data() : null);
            });
            // Prepare batch
            for (const entity of chunk) {
                const before = (_a = before_states.get(entity.id)) !== null && _a !== void 0 ? _a : null;
                const entity_to_save = Object.assign(Object.assign({}, entity), { updated_at: firestore_1.Timestamp.now() });
                const doc_data = map_to_doc(entity_to_save);
                batch.set(doc_ref(entity.id), doc_data);
                results.push((0, types_1.create_write_result)("account", entity.id, "replace", before, doc_data));
                // Audit entry (async)
                (0, audit_1.record_audit_entry_async)({
                    user_id: entity.user_id,
                    action: before ? "update" : "create",
                    entity_type: "account",
                    entity_id: entity.id,
                    before: before,
                    after: doc_data,
                    trace_id: ctx.trace_id,
                    metadata: { source: "api" },
                });
            }
            await batch.commit();
        }
        return {
            results,
            count: entities.length,
            success: true,
        };
    },
    /**
     * Soft-deletes an account.
     *
     * @param ctx - Trace context
     * @param id - Account ID
     * @param user_id - User performing the delete
     * @returns Write result
     */
    async soft_delete(ctx, id, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Account ${id} not found`);
        }
        const before = before_doc.data();
        /* eslint-disable @typescript-eslint/naming-convention */
        const after = Object.assign(Object.assign({}, before), { isActive: false, isDeleted: true, updatedAt: firestore_1.Timestamp.now() });
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).set(after);
        // Audit entry (async)
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "delete",
            entity_type: "account",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("account", id, "replace", before, after);
    },
    /**
     * Restores a soft-deleted account.
     *
     * @param ctx - Trace context
     * @param id - Account ID
     * @param user_id - User performing the restore
     * @returns Write result
     */
    async restore(ctx, id, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Account ${id} not found`);
        }
        const before = before_doc.data();
        /* eslint-disable @typescript-eslint/naming-convention */
        const after = Object.assign(Object.assign({}, before), { isActive: true, isDeleted: false, updatedAt: firestore_1.Timestamp.now() });
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).set(after);
        // Audit entry (async)
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "restore",
            entity_type: "account",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("account", id, "replace", before, after);
    },
    /**
     * Updates account balances.
     * Optimized update that only touches balance fields.
     *
     * @param ctx - Trace context
     * @param id - Account ID
     * @param balances - New balance information
     * @param user_id - User performing the update
     * @returns Write result
     */
    async update_balances(ctx, id, balances, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Account ${id} not found`);
        }
        const before = before_doc.data();
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
            currentBalance: balances.current,
            availableBalance: balances.available,
            limit: balances.limit,
            lastBalanceUpdate: now,
            updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).update(update_data);
        const after = Object.assign(Object.assign({}, before), update_data);
        // Audit entry (async)
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "update",
            entity_type: "account",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { balance_update: true } },
        });
        return (0, types_1.create_write_result)("account", id, "merge", before, after);
    },
    /**
     * Counts accounts for a user.
     *
     * @param _ctx - Trace context
     * @param user_id - User ID
     * @param include_deleted - Include soft-deleted accounts
     * @returns Count of accounts
     */
    async count_by_user_id(_ctx, user_id, include_deleted = false) {
        const db = (0, firestore_1.getFirestore)();
        let query = db.collection(COLLECTION).where("userId", "==", user_id);
        if (!include_deleted) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query.count().get();
        return snapshot.data().count;
    },
    /**
     * Checks if an account exists.
     *
     * @param _ctx - Trace context
     * @param id - Account ID
     * @returns Whether the account exists
     */
    async exists(_ctx, id) {
        const doc = await doc_ref(id).get();
        return doc.exists;
    },
    /**
     * Gets an account by Plaid account ID.
     *
     * @param _ctx - Trace context
     * @param plaid_account_id - Plaid account ID
     * @param user_id - User ID for scoping query
     * @returns Account entity or null if not found
     */
    async get_by_plaid_account_id(_ctx, plaid_account_id, user_id) {
        const db = (0, firestore_1.getFirestore)();
        const snapshot = await db
            .collection(COLLECTION)
            .where("accountId", "==", plaid_account_id)
            .where("userId", "==", user_id)
            .where("isActive", "==", true)
            .limit(1)
            .get();
        if (snapshot.empty) {
            return null;
        }
        return map_to_entity(snapshot.docs[0].data());
    },
    /**
     * Upserts accounts from Plaid data.
     *
     * For each account:
     * - If exists (by plaid_account_id): updates balances only
     * - If new: creates the full account
     *
     * This is the shared logic used by both initial sync and balance refresh.
     *
     * @param ctx - Trace context
     * @param plaid_accounts - Array of Plaid account data
     * @param item_id - Plaid item ID
     * @param user_id - User ID
     * @param institution - Institution info
     * @param group_id - Optional group ID for sharing
     * @returns Upsert results with created/updated counts
     */
    async upsert_from_plaid(ctx, plaid_accounts, item_id, user_id, institution, group_id) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        let created = 0;
        let updated = 0;
        const results = [];
        // Process in batches
        const chunks = (0, types_1.chunk_for_batch)(plaid_accounts);
        for (const chunk of chunks) {
            const batch = db.batch();
            for (const plaid_account of chunk) {
                // Check if account exists
                const existing = await this.get_by_plaid_account_id(ctx, plaid_account.account_id, user_id);
                const new_balance = (_a = plaid_account.balances.current) !== null && _a !== void 0 ? _a : 0;
                if (existing) {
                    // UPDATE: Only update balances
                    const ref = doc_ref(existing.id);
                    /* eslint-disable @typescript-eslint/naming-convention */
                    const update_data = {
                        currentBalance: new_balance,
                        availableBalance: (_b = plaid_account.balances.available) !== null && _b !== void 0 ? _b : undefined,
                        limit: (_c = plaid_account.balances.limit) !== null && _c !== void 0 ? _c : undefined,
                        lastBalanceUpdate: now,
                        updatedAt: now,
                    };
                    /* eslint-enable @typescript-eslint/naming-convention */
                    batch.update(ref, update_data);
                    results.push({
                        plaid_account_id: plaid_account.account_id,
                        doc_id: existing.id,
                        action: "updated",
                        previous_balance: existing.balances.current,
                        new_balance,
                    });
                    updated++;
                    // Audit entry
                    (0, audit_1.record_audit_entry_async)({
                        user_id,
                        action: "update",
                        entity_type: "account",
                        entity_id: existing.id,
                        before: { currentBalance: existing.balances.current },
                        after: { currentBalance: new_balance },
                        trace_id: ctx.trace_id,
                        metadata: { source: "api", context: { balance_update: true } },
                    });
                }
                else {
                    // CREATE: Full account creation
                    const doc_id = db.collection(COLLECTION).doc().id;
                    const ref = doc_ref(doc_id);
                    const group_ids = group_id ? [group_id] : [];
                    /* eslint-disable @typescript-eslint/naming-convention */
                    const doc_data = {
                        id: doc_id,
                        userId: user_id,
                        groupIds: group_ids,
                        isActive: true,
                        isDeleted: false,
                        createdAt: now,
                        updatedAt: now,
                        accountId: plaid_account.account_id,
                        plaidAccountId: plaid_account.account_id, // Mobile app expects this field
                        itemId: item_id,
                        name: plaid_account.name,
                        accountName: plaid_account.name,
                        mask: (_d = plaid_account.mask) !== null && _d !== void 0 ? _d : undefined,
                        officialName: (_e = plaid_account.official_name) !== null && _e !== void 0 ? _e : undefined,
                        accountType: plaid_account.type,
                        accountSubtype: (_f = plaid_account.subtype) !== null && _f !== void 0 ? _f : "unknown",
                        currentBalance: new_balance,
                        availableBalance: (_g = plaid_account.balances.available) !== null && _g !== void 0 ? _g : undefined,
                        limit: (_h = plaid_account.balances.limit) !== null && _h !== void 0 ? _h : undefined,
                        isoCurrencyCode: (_j = plaid_account.balances.iso_currency_code) !== null && _j !== void 0 ? _j : "USD",
                        lastBalanceUpdate: now,
                        institutionId: institution.id,
                        institutionName: institution.name,
                        isSyncEnabled: true,
                        access: {
                            ownerId: user_id,
                            createdBy: user_id,
                            groupIds: group_ids,
                            isPrivate: group_ids.length === 0,
                        },
                    };
                    /* eslint-enable @typescript-eslint/naming-convention */
                    batch.set(ref, doc_data);
                    results.push({
                        plaid_account_id: plaid_account.account_id,
                        doc_id,
                        action: "created",
                        new_balance,
                    });
                    created++;
                    // Audit entry
                    (0, audit_1.record_audit_entry_async)({
                        user_id,
                        action: "create",
                        entity_type: "account",
                        entity_id: doc_id,
                        before: null,
                        after: doc_data,
                        trace_id: ctx.trace_id,
                        metadata: { source: "api" },
                    });
                }
            }
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] upsert_from_plaid: created=${created}, updated=${updated}`);
        return { created, updated, results };
    },
    /**
     * Gets accounts for a user in client response format (camelCase).
     *
     * This method is used by orchestrators to return account data
     * directly to the entry layer without additional transformation.
     *
     * @param _ctx - Trace context
     * @param user_id - User ID
     * @param item_id - Optional: filter by Plaid item ID
     * @returns Array of accounts in client format
     */
    async get_for_client_response(_ctx, user_id, item_id) {
        const db = (0, firestore_1.getFirestore)();
        let query = db
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .where("isActive", "==", true);
        if (item_id) {
            query = query.where("itemId", "==", item_id);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const data = doc.data();
            // Return in camelCase format expected by frontend
            return {
                id: doc.id,
                plaidAccountId: data.accountId,
                accountId: data.accountId,
                itemId: data.itemId,
                userId: data.userId,
                familyId: ((_a = data.groupIds) === null || _a === void 0 ? void 0 : _a[0]) || "",
                institutionId: data.institutionId,
                institutionName: data.institutionName,
                accountName: data.name || data.accountName || "",
                accountType: data.accountType,
                accountSubtype: data.accountSubtype,
                mask: data.mask,
                officialName: data.officialName,
                currentBalance: data.currentBalance,
                availableBalance: data.availableBalance,
                creditLimit: data.limit,
                isoCurrencyCode: data.isoCurrencyCode || "USD",
                isActive: data.isActive,
                isSyncEnabled: (_b = data.isSyncEnabled) !== null && _b !== void 0 ? _b : true,
                lastBalanceUpdate: (_d = (_c = data.lastBalanceUpdate) === null || _c === void 0 ? void 0 : _c.toDate) === null || _d === void 0 ? void 0 : _d.call(_c),
                lastUpdated: ((_f = (_e = data.lastBalanceUpdate) === null || _e === void 0 ? void 0 : _e.toDate) === null || _f === void 0 ? void 0 : _f.call(_e)) || ((_h = (_g = data.updatedAt) === null || _g === void 0 ? void 0 : _g.toDate) === null || _h === void 0 ? void 0 : _h.call(_g)),
                createdAt: (_k = (_j = data.createdAt) === null || _j === void 0 ? void 0 : _j.toDate) === null || _k === void 0 ? void 0 : _k.call(_j),
                updatedAt: (_m = (_l = data.updatedAt) === null || _l === void 0 ? void 0 : _l.toDate) === null || _m === void 0 ? void 0 : _m.call(_l),
            };
        });
    },
};
//# sourceMappingURL=account.repo.js.map