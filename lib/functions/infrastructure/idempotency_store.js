"use strict";
/**
 * Idempotency Store
 *
 * High-level idempotency utilities built on the repository layer.
 * Provides convenient functions for common idempotency patterns.
 *
 * Keys expire after 24 hours (configurable).
 *
 * @module infrastructure/idempotency_store
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.check_idempotency = check_idempotency;
exports.claim_key = claim_key;
exports.complete_key = complete_key;
exports.fail_key = fail_key;
exports.release_key = release_key;
exports.cleanup_expired_records = cleanup_expired_records;
exports.get_active_count = get_active_count;
const infrastructure_1 = require("../repositories/infrastructure");
/**
 * Default TTL for idempotency records (24 hours).
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Checks if an operation with this key has already been processed.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @returns Check result indicating if this is a duplicate
 *
 * @example
 * const check = await check_idempotency(ctx, "user123:create_budget:abc");
 * if (check.is_duplicate) {
 *   if (check.status === "completed") {
 *     return check.cached_result;
 *   }
 *   if (check.status === "in_progress") {
 *     throw new Error("Operation in progress");
 *   }
 * }
 */
async function check_idempotency(ctx, key) {
    var _a;
    const record = await (0, infrastructure_1.get_idempotency_record)(ctx, key);
    if (!record) {
        return { is_duplicate: false };
    }
    switch (record.status) {
        case "in_progress":
            return { is_duplicate: true, status: "in_progress" };
        case "completed":
            return {
                is_duplicate: true,
                status: "completed",
                cached_result: record.result,
            };
        case "failed":
            return {
                is_duplicate: true,
                status: "failed",
                error_message: (_a = record.error_message) !== null && _a !== void 0 ? _a : "Unknown error",
            };
    }
}
/**
 * Claims an idempotency key for processing.
 * Uses a transaction to ensure only one caller can claim the key.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @param ttl_ms - TTL in milliseconds (default: 24 hours)
 * @returns true if claimed, false if already claimed
 *
 * @example
 * const claimed = await claim_key(ctx, "user123:create_budget:abc");
 * if (!claimed) {
 *   throw new Error("Operation already in progress");
 * }
 */
async function claim_key(ctx, key, ttl_ms = DEFAULT_TTL_MS) {
    return (0, infrastructure_1.claim_idempotency_key)(ctx, key, ttl_ms);
}
/**
 * Marks an idempotency key as completed with a cached result.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @param result - The result to cache
 *
 * @example
 * await complete_key(ctx, "user123:create_budget:abc", { budget_id: "xyz" });
 */
async function complete_key(ctx, key, result) {
    await (0, infrastructure_1.update_idempotency_record)(ctx, key, {
        status: "completed",
        result,
    });
}
/**
 * Marks an idempotency key as failed.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 * @param error_message - Error message to store
 *
 * @example
 * await fail_key(ctx, "user123:create_budget:abc", "Validation failed");
 */
async function fail_key(ctx, key, error_message) {
    await (0, infrastructure_1.update_idempotency_record)(ctx, key, {
        status: "failed",
        error_message,
    });
}
/**
 * Releases an idempotency key (removes the in_progress record).
 * Use this when you want to allow retry without waiting for expiration.
 *
 * @param ctx - Trace context
 * @param key - The idempotency key
 */
async function release_key(ctx, key) {
    await (0, infrastructure_1.delete_idempotency_record)(ctx, key);
}
/**
 * Deletes expired idempotency records.
 * Called by scheduled cleanup job.
 *
 * @param ctx - Trace context
 * @param batch_size - Maximum records to delete per batch
 * @returns Number of records deleted
 */
async function cleanup_expired_records(ctx, batch_size = 500) {
    const result = await (0, infrastructure_1.delete_expired_idempotency_records)(ctx, batch_size);
    return result.deleted_count;
}
/**
 * Gets count of active (non-expired) idempotency records.
 * Useful for monitoring.
 *
 * @param ctx - Trace context
 */
async function get_active_count(ctx) {
    return (0, infrastructure_1.get_active_idempotency_count)(ctx);
}
//# sourceMappingURL=idempotency_store.js.map