"use strict";
/**
 * Audit Trail Writer
 *
 * Provides append-only audit logging for all repository writes.
 * Audit entries are NEVER deleted - they form an immutable record.
 *
 * @module audit/writer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.record_audit_entry = record_audit_entry;
exports.record_audit_entry_async = record_audit_entry_async;
exports.record_audit_entries_batch = record_audit_entries_batch;
exports.query_audit_entries = query_audit_entries;
exports.get_entity_audit_history = get_entity_audit_history;
exports.get_latest_audit_entry = get_latest_audit_entry;
exports.has_audit_history = has_audit_history;
const firestore_1 = require("firebase-admin/firestore");
const uuid_1 = require("uuid");
const types_1 = require("../types");
const observability_1 = require("../observability");
/**
 * Firestore collection for audit entries.
 * This collection is append-only and should NEVER be deleted.
 */
const AUDIT_COLLECTION = "_audit";
/**
 * Computes the list of changed fields between before and after states.
 */
function compute_changed_fields(before, after) {
    if (!before || !after) {
        return [];
    }
    const all_keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [];
    for (const key of all_keys) {
        const before_val = JSON.stringify(before[key]);
        const after_val = JSON.stringify(after[key]);
        if (before_val !== after_val) {
            changed.push(key);
        }
    }
    return changed;
}
/**
 * Creates a complete audit entry from input.
 */
function create_audit_entry(input) {
    const before_hash = input.before ? (0, types_1.compute_hash)(input.before) : "null";
    const after_hash = input.after ? (0, types_1.compute_hash)(input.after) : "null";
    const changed_fields = input.action === "update"
        ? compute_changed_fields(input.before, input.after)
        : undefined;
    return {
        audit_id: (0, uuid_1.v4)(),
        timestamp: firestore_1.Timestamp.now(),
        user_id: input.user_id,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        before: input.before,
        after: input.after,
        trace_id: input.trace_id,
        before_hash,
        after_hash,
        changed_fields,
        metadata: input.metadata,
    };
}
/**
 * Records an audit entry synchronously.
 * Use this when you need to ensure the audit is written before proceeding.
 *
 * @param input - Audit entry input
 * @returns The created audit entry
 */
async function record_audit_entry(input) {
    const entry = create_audit_entry(input);
    const db = (0, firestore_1.getFirestore)();
    await db.collection(AUDIT_COLLECTION).doc(entry.audit_id).set(entry);
    return entry;
}
/**
 * Records an audit entry asynchronously (fire-and-forget).
 * Use this for non-critical audit logging that shouldn't block the main flow.
 *
 * @param input - Audit entry input
 */
function record_audit_entry_async(input) {
    (0, observability_1.fire_and_forget)(async () => {
        await record_audit_entry(input);
    });
}
/**
 * Records multiple audit entries in a batch.
 * Use this when multiple entities are affected by a single operation.
 *
 * @param inputs - Array of audit entry inputs
 * @returns Array of created audit entries
 */
async function record_audit_entries_batch(inputs) {
    if (inputs.length === 0) {
        return [];
    }
    const db = (0, firestore_1.getFirestore)();
    const batch = db.batch();
    const entries = [];
    for (const input of inputs) {
        const entry = create_audit_entry(input);
        entries.push(entry);
        batch.set(db.collection(AUDIT_COLLECTION).doc(entry.audit_id), entry);
    }
    await batch.commit();
    return entries;
}
/**
 * Queries audit entries with filtering options.
 * For support and debugging purposes.
 *
 * @param options - Query options
 * @returns Matching audit entries
 */
async function query_audit_entries(options) {
    var _a, _b;
    const db = (0, firestore_1.getFirestore)();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = db.collection(AUDIT_COLLECTION);
    // Apply filters
    if (options.entity_type) {
        query = query.where("entity_type", "==", options.entity_type);
    }
    if (options.entity_id) {
        query = query.where("entity_id", "==", options.entity_id);
    }
    if (options.user_id) {
        query = query.where("user_id", "==", options.user_id);
    }
    if (options.action) {
        query = query.where("action", "==", options.action);
    }
    if (options.start_time) {
        query = query.where("timestamp", ">=", options.start_time);
    }
    if (options.end_time) {
        query = query.where("timestamp", "<=", options.end_time);
    }
    // Apply ordering
    const order = (_a = options.order) !== null && _a !== void 0 ? _a : "desc";
    query = query.orderBy("timestamp", order);
    // Apply limit
    const limit = (_b = options.limit) !== null && _b !== void 0 ? _b : 100;
    query = query.limit(limit + 1); // Fetch one extra to check has_more
    const snapshot = await query.get();
    const entries = [];
    snapshot.docs.slice(0, limit).forEach((doc) => {
        entries.push(doc.data());
    });
    return {
        entries,
        has_more: snapshot.docs.length > limit,
    };
}
/**
 * Gets the full audit history for a specific entity.
 * Returns all changes from creation to current state.
 *
 * @param entity_type - Type of entity
 * @param entity_id - Entity ID
 * @returns All audit entries for the entity, oldest first
 */
async function get_entity_audit_history(entity_type, entity_id) {
    const result = await query_audit_entries({
        entity_type,
        entity_id,
        order: "asc",
        limit: 1000, // Reasonable limit for entity history
    });
    return result.entries;
}
/**
 * Gets the most recent audit entry for an entity.
 * Useful for quick change detection.
 *
 * @param entity_type - Type of entity
 * @param entity_id - Entity ID
 * @returns Most recent audit entry or null
 */
async function get_latest_audit_entry(entity_type, entity_id) {
    var _a;
    const result = await query_audit_entries({
        entity_type,
        entity_id,
        order: "desc",
        limit: 1,
    });
    return (_a = result.entries[0]) !== null && _a !== void 0 ? _a : null;
}
/**
 * Checks if an entity has any audit history.
 * Quick existence check without fetching full data.
 *
 * @param entity_type - Type of entity
 * @param entity_id - Entity ID
 * @returns Whether audit history exists
 */
async function has_audit_history(entity_type, entity_id) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db
        .collection(AUDIT_COLLECTION)
        .where("entity_type", "==", entity_type)
        .where("entity_id", "==", entity_id)
        .limit(1)
        .get();
    return !snapshot.empty;
}
//# sourceMappingURL=audit_writer.js.map