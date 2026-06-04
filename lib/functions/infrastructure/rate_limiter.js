"use strict";
/**
 * Rate Limiter
 *
 * Provides rate limiting using a sliding window algorithm.
 * Prevents abuse and ensures fair resource usage.
 *
 * Note: Background jobs are exempt from rate limiting.
 *
 * @module infrastructure/rate_limiter
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LIMITS = void 0;
exports.check_rate_limit = check_rate_limit;
exports.record_request = record_request;
exports.check_and_record = check_and_record;
exports.cleanup_rate_limits = cleanup_rate_limits;
exports.user_rate_key = user_rate_key;
exports.ip_rate_key = ip_rate_key;
exports.global_rate_key = global_rate_key;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection for rate limit tracking.
 */
const COLLECTION = "_rate_limits";
/**
 * Default rate limits for different contexts.
 */
exports.DEFAULT_LIMITS = {
    /** Per-user API call limit */
    USER_API: { max_requests: 100, window_ms: 60000 }, // 100/min
    /** Per-user write operation limit */
    USER_WRITES: { max_requests: 50, window_ms: 60000 }, // 50/min
    /** Global Plaid API limit (to stay within Plaid's limits) */
    PLAID_API: { max_requests: 30, window_ms: 60000 }, // 30/min
    /** Per-IP unauthenticated limit */
    IP_UNAUTH: { max_requests: 20, window_ms: 60000 }, // 20/min
};
/**
 * Checks if a request is allowed under the rate limit.
 *
 * @param key - Unique key for rate limiting (e.g., "user:abc123:api")
 * @param config - Rate limit configuration
 * @returns Rate limit result
 *
 * @example
 * const result = await check_rate_limit(
 *   `user:${user_id}:api`,
 *   DEFAULT_LIMITS.USER_API
 * );
 * if (!result.allowed) {
 *   throw new HttpsError('resource-exhausted', 'Rate limited');
 * }
 */
async function check_rate_limit(key, config) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(key);
    const now = Date.now();
    const window_start = now - config.window_ms;
    const doc = await doc_ref.get();
    if (!doc.exists) {
        return {
            allowed: true,
            current_count: 0,
            max_requests: config.max_requests,
            reset_in_ms: config.window_ms,
        };
    }
    const data = doc.data();
    // Filter to only timestamps within the current window
    const valid_timestamps = data.timestamps.filter((ts) => ts.toMillis() > window_start);
    const current_count = valid_timestamps.length;
    if (current_count >= config.max_requests) {
        // Find when the oldest request in the window will expire
        const oldest = Math.min(...valid_timestamps.map((ts) => ts.toMillis()));
        const retry_after_ms = oldest + config.window_ms - now;
        return {
            allowed: false,
            current_count,
            max_requests: config.max_requests,
            reset_in_ms: retry_after_ms,
            retry_after_ms: Math.max(0, retry_after_ms),
        };
    }
    return {
        allowed: true,
        current_count,
        max_requests: config.max_requests,
        reset_in_ms: config.window_ms,
    };
}
/**
 * Records a request for rate limiting.
 * Call this after check_rate_limit returns allowed: true.
 *
 * @param key - Unique key for rate limiting
 * @param config - Rate limit configuration
 */
async function record_request(key, config) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(key);
    const now = firestore_1.Timestamp.now();
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(doc_ref);
        if (!doc.exists) {
            const new_doc = {
                timestamps: [now],
                window_start: now,
                config,
            };
            transaction.set(doc_ref, new_doc);
            return;
        }
        const data = doc.data();
        const window_start = Date.now() - config.window_ms;
        // Filter out expired timestamps and add the new one
        const valid_timestamps = data.timestamps.filter((ts) => ts.toMillis() > window_start);
        valid_timestamps.push(now);
        transaction.update(doc_ref, {
            timestamps: valid_timestamps,
        });
    });
}
/**
 * Checks and records a request in a single operation.
 * More efficient than separate check + record calls.
 *
 * @param key - Unique key for rate limiting
 * @param config - Rate limit configuration
 * @returns Rate limit result (request is recorded if allowed)
 */
async function check_and_record(key, config) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(key);
    const now = firestore_1.Timestamp.now();
    const now_ms = now.toMillis();
    const window_start_ms = now_ms - config.window_ms;
    const result = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(doc_ref);
        let valid_timestamps = [];
        if (doc.exists) {
            const data = doc.data();
            valid_timestamps = data.timestamps.filter((ts) => ts.toMillis() > window_start_ms);
        }
        const current_count = valid_timestamps.length;
        if (current_count >= config.max_requests) {
            // Rate limited - don't record, just return result
            const oldest = Math.min(...valid_timestamps.map((ts) => ts.toMillis()));
            const retry_after_ms = oldest + config.window_ms - now_ms;
            return {
                allowed: false,
                current_count,
                max_requests: config.max_requests,
                reset_in_ms: retry_after_ms,
                retry_after_ms: Math.max(0, retry_after_ms),
            };
        }
        // Allowed - record the request
        valid_timestamps.push(now);
        if (doc.exists) {
            transaction.update(doc_ref, { timestamps: valid_timestamps });
        }
        else {
            const new_doc = {
                timestamps: valid_timestamps,
                window_start: now,
                config,
            };
            transaction.set(doc_ref, new_doc);
        }
        return {
            allowed: true,
            current_count: current_count + 1,
            max_requests: config.max_requests,
            reset_in_ms: config.window_ms,
        };
    });
    return result;
}
/**
 * Cleans up expired rate limit records.
 * Should be called by a scheduled job.
 *
 * @param older_than_ms - Delete records not updated in this many ms
 * @returns Number of records deleted
 */
async function cleanup_rate_limits(older_than_ms = 24 * 60 * 60 * 1000 // 24 hours
) {
    const db = (0, firestore_1.getFirestore)();
    const cutoff = firestore_1.Timestamp.fromMillis(Date.now() - older_than_ms);
    const old_docs = await db
        .collection(COLLECTION)
        .where("window_start", "<", cutoff)
        .limit(500)
        .get();
    if (old_docs.empty) {
        return 0;
    }
    const batch = db.batch();
    old_docs.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return old_docs.size;
}
/**
 * Builds a rate limit key for a user.
 *
 * @param user_id - User ID
 * @param action - Action type (e.g., "api", "writes")
 */
function user_rate_key(user_id, action) {
    return `user:${user_id}:${action}`;
}
/**
 * Builds a rate limit key for an IP address.
 *
 * @param ip - IP address
 * @param action - Action type
 */
function ip_rate_key(ip, action) {
    return `ip:${ip}:${action}`;
}
/**
 * Builds a rate limit key for a global resource.
 *
 * @param resource - Resource name (e.g., "plaid")
 */
function global_rate_key(resource) {
    return `global:${resource}`;
}
//# sourceMappingURL=rate_limiter.js.map