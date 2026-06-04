"use strict";
/**
 * Plaid Item Repository
 *
 * Handles persistence for Plaid item entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/plaid/plaid_item
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaid_item_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const audit_1 = require("../../audit");
/**
 * Firestore collection name.
 */
const COLLECTION = "plaid_items";
/**
 * Gets the Firestore instance.
 */
function get_db() {
    return (0, firestore_1.getFirestore)();
}
/**
 * Gets a document reference.
 */
function doc_ref(id) {
    return get_db().collection(COLLECTION).doc(id);
}
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * Maps legacy Firestore document to PlaidItem entity.
 */
function map_to_entity(doc) {
    var _a, _b, _c, _d, _e;
    return {
        id: doc.id,
        plaid_item_id: doc.plaidItemId,
        user_id: doc.userId,
        group_ids: (_a = doc.groupIds) !== null && _a !== void 0 ? _a : [],
        institution_id: doc.institutionId,
        institution_name: doc.institutionName,
        institution_logo: doc.institutionLogo,
        access_token: doc.accessToken,
        cursor: doc.cursor,
        products: (_b = doc.products) !== null && _b !== void 0 ? _b : ["transactions"],
        status: doc.status,
        error: doc.error,
        last_webhook_received: doc.lastWebhookReceived,
        last_sync_error: (_c = doc.lastSyncError) !== null && _c !== void 0 ? _c : null,
        last_sync_error_at: (_d = doc.lastSyncErrorAt) !== null && _d !== void 0 ? _d : null,
        last_synced_at: (_e = doc.lastSyncedAt) !== null && _e !== void 0 ? _e : null,
        is_active: doc.isActive,
        created_at: doc.createdAt,
        updated_at: doc.updatedAt,
    };
}
/**
 * Maps PlaidItem entity to legacy Firestore document.
 */
function map_to_doc(entity) {
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        id: entity.id,
        plaidItemId: entity.plaid_item_id,
        userId: entity.user_id,
        groupIds: entity.group_ids,
        institutionId: entity.institution_id,
        institutionName: entity.institution_name,
        institutionLogo: entity.institution_logo,
        accessToken: entity.access_token,
        cursor: entity.cursor,
        products: entity.products,
        status: entity.status,
        error: entity.error,
        lastWebhookReceived: entity.last_webhook_received,
        lastSyncError: entity.last_sync_error,
        lastSyncErrorAt: entity.last_sync_error_at,
        lastSyncedAt: entity.last_synced_at,
        isActive: entity.is_active,
        createdAt: entity.created_at,
        updatedAt: entity.updated_at,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
/**
 * Plaid Item Repository
 *
 * Provides methods for CRUD operations on Plaid items.
 * All write operations automatically create audit entries.
 */
exports.plaid_item_repo = {
    /**
     * Gets a Plaid item by ID.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @returns PlaidItem entity or null if not found
     */
    async get_by_id(ctx, id) {
        const doc = await doc_ref(id).get();
        if (!doc.exists) {
            return null;
        }
        return map_to_entity(doc.data());
    },
    /**
     * Gets all Plaid items for a user.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param include_inactive - Include inactive items
     * @returns Array of PlaidItem entities
     */
    async get_by_user_id(ctx, user_id, include_inactive = false) {
        const db = get_db();
        let query = db.collection(COLLECTION).where("userId", "==", user_id);
        if (!include_inactive) {
            query = query.where("isActive", "==", true);
        }
        const snapshot = await query.get();
        return snapshot.docs.map((doc) => map_to_entity(doc.data()));
    },
    /**
     * Gets all ACTIVE items currently in one of the given (transient) statuses,
     * across all users. Used by the auto-retry scheduled job.
     *
     * Queries by `status in [...]` (single-field index — no composite index
     * needed) and filters `isActive` in memory.
     *
     * @param ctx - Trace context
     * @param statuses - Status values to match (max 10 for an `in` query)
     * @returns Lightweight rows describing items to retry
     */
    async get_in_transient_state(ctx, statuses) {
        var _a, _b;
        if (statuses.length === 0) {
            return [];
        }
        const db = get_db();
        const snapshot = await db
            .collection(COLLECTION)
            .where("status", "in", statuses)
            .get();
        const rows = [];
        for (const doc of snapshot.docs) {
            const legacy = doc.data();
            const raw = doc.data();
            if (raw.isActive === false) {
                continue;
            }
            rows.push({
                item_doc_id: doc.id,
                plaid_item_id: legacy.plaidItemId,
                user_id: legacy.userId,
                status: legacy.status,
                error_code: (_a = legacy.error) !== null && _a !== void 0 ? _a : null,
                transient_since: (_b = raw.transientSince) !== null && _b !== void 0 ? _b : null,
            });
        }
        return rows;
    },
    /**
     * Gets a Plaid item by user and institution.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param institution_id - Institution ID
     * @returns PlaidItem entity or null if not found
     */
    async get_by_user_and_institution(ctx, user_id, institution_id) {
        const db = get_db();
        const snapshot = await db
            .collection(COLLECTION)
            .where("userId", "==", user_id)
            .where("institutionId", "==", institution_id)
            .where("isActive", "==", true)
            .limit(1)
            .get();
        if (snapshot.empty) {
            return null;
        }
        return map_to_entity(snapshot.docs[0].data());
    },
    /**
     * Saves a Plaid item (create or update).
     *
     * @param ctx - Trace context
     * @param entity - PlaidItem entity to save
     * @returns WriteResult
     */
    async save(ctx, entity) {
        // Structural validation
        if (!entity.id) {
            throw new Error("Plaid item ID is required");
        }
        if (!entity.user_id) {
            throw new Error("User ID is required");
        }
        // Get before state for audit
        const before_doc = await doc_ref(entity.id).get();
        const before = before_doc.exists
            ? before_doc.data()
            : null;
        // Ensure updated_at is set
        const entity_to_save = Object.assign(Object.assign({}, entity), { updated_at: firestore_1.Timestamp.now() });
        // Convert to legacy format and save
        const doc_data = map_to_doc(entity_to_save);
        await doc_ref(entity.id).set(doc_data);
        // Create audit entry (async, non-blocking)
        (0, audit_1.record_audit_entry_async)({
            user_id: entity.user_id,
            action: before ? "update" : "create",
            entity_type: "plaid_item",
            entity_id: entity.id,
            before: before,
            after: doc_data,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("plaid_item", entity.id, "replace", before, doc_data);
    },
    /**
     * Soft-deletes a Plaid item (sets isActive = false).
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @param user_id - User performing the delete
     * @returns WriteResult
     */
    async soft_delete(ctx, id, user_id) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) {
            throw new Error(`Plaid item ${id} not found`);
        }
        const before = before_doc.data();
        /* eslint-disable @typescript-eslint/naming-convention */
        const after = Object.assign(Object.assign({}, before), { isActive: false, updatedAt: firestore_1.Timestamp.now() });
        /* eslint-enable @typescript-eslint/naming-convention */
        await doc_ref(id).set(after);
        // Audit entry (async)
        (0, audit_1.record_audit_entry_async)({
            user_id,
            action: "delete",
            entity_type: "plaid_item",
            entity_id: id,
            before: before,
            after: after,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
        });
        return (0, types_1.create_write_result)("plaid_item", id, "replace", before, after);
    },
    /**
     * Updates the sync cursor for a Plaid item.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @param cursor - New cursor value
     */
    async update_cursor(ctx, id, cursor) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            cursor,
            lastSyncedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Updates the status of a Plaid item.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @param status - New status
     * @param error - Error message (if status indicates error)
     */
    async update_status(ctx, id, status, error = null) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            status,
            error,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /**
     * Updates the last synced timestamp for a Plaid item.
     *
     * @param ctx - Trace context
     * @param id - Plaid item document ID
     */
    async update_last_synced_at(ctx, id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            lastSyncedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        console.log(`[${ctx.trace_id}] Updated lastSyncedAt for item ${id}`);
    },
    /**
     * Checks if a Plaid item exists.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @returns Whether the item exists
     */
    async exists(ctx, id) {
        const doc = await doc_ref(id).get();
        return doc.exists;
    },
    /**
     * Updates the last recurring sync timestamp for a Plaid item.
     *
     * This is separate from lastSyncedAt which tracks transaction sync.
     *
     * @param ctx - Trace context
     * @param id - Plaid item document ID
     */
    async update_last_recurring_sync_at(ctx, id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            lastRecurringSyncAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        console.log(`[${ctx.trace_id}] Updated lastRecurringSyncAt for item ${id}`);
    },
};
//# sourceMappingURL=plaid_item.repo.js.map