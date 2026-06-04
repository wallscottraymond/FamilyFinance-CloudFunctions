"use strict";
/**
 * Repository Types for Persistence Layer
 *
 * These types define the contract for all repository operations.
 * Repositories handle Firestore access and return consistent results.
 *
 * @module types/repository
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIRESTORE_BATCH_LIMIT = void 0;
exports.compute_hash = compute_hash;
exports.create_write_result = create_write_result;
exports.chunk_for_batch = chunk_for_batch;
/**
 * Computes a simple hash of an object for change detection.
 * Used in WriteResult for before/after comparison.
 */
function compute_hash(obj) {
    if (obj === null || obj === undefined) {
        return "null";
    }
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
}
/**
 * Creates a WriteResult for a write operation.
 */
function create_write_result(entity_type, entity_id, operation, before, after) {
    return {
        entity_type,
        entity_id,
        operation,
        before_hash: compute_hash(before),
        after_hash: compute_hash(after),
    };
}
/**
 * Maximum documents per Firestore batch write.
 * Must split larger batches to respect this limit.
 */
exports.FIRESTORE_BATCH_LIMIT = 500;
/**
 * Splits an array into chunks for batch processing.
 */
function chunk_for_batch(items, size = exports.FIRESTORE_BATCH_LIMIT) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
//# sourceMappingURL=repository.js.map