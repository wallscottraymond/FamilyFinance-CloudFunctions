"use strict";
/**
 * Runtime Configuration
 *
 * Provides access to tunable configuration values.
 * Config is stored in Firestore _config collection with in-memory caching.
 *
 * @module infrastructure/config
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_INFRASTRUCTURE_CONFIG = void 0;
exports.get_infrastructure_config = get_infrastructure_config;
exports.invalidate_config_cache = invalidate_config_cache;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Default configuration values.
 * Used when Firestore config is unavailable.
 */
exports.DEFAULT_INFRASTRUCTURE_CONFIG = {
    log_retention: {
        minimal: 30,
        debug: 7,
        traces: 30,
    },
    trigger_retention_days: 7,
    soft_delete_retention_days: 30,
    idempotency_ttl_ms: 24 * 60 * 60 * 1000, // 24 hours
    quota: {
        warning_threshold_percent: 80,
        critical_threshold_percent: 95,
        daily_reads_limit: 50000,
        daily_writes_limit: 20000,
    },
    quota_retention_days: 30,
    cleanup_batch_size: 500,
    cleanup_max_batches: 20,
};
/**
 * Cached configuration.
 */
let cached_config = null;
let cache_timestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Gets infrastructure configuration.
 * Retrieves from Firestore with caching, falls back to defaults.
 *
 * @returns Infrastructure configuration
 */
async function get_infrastructure_config() {
    // Return cached if still valid
    if (cached_config && Date.now() - cache_timestamp < CACHE_TTL_MS) {
        return cached_config;
    }
    try {
        const db = (0, firestore_1.getFirestore)();
        const doc = await db.collection("_config").doc("infrastructure").get();
        if (doc.exists) {
            const data = doc.data();
            // Merge with defaults to ensure all fields exist
            cached_config = Object.assign(Object.assign(Object.assign({}, exports.DEFAULT_INFRASTRUCTURE_CONFIG), data), { log_retention: Object.assign(Object.assign({}, exports.DEFAULT_INFRASTRUCTURE_CONFIG.log_retention), data.log_retention), quota: Object.assign(Object.assign({}, exports.DEFAULT_INFRASTRUCTURE_CONFIG.quota), data.quota) });
        }
        else {
            cached_config = exports.DEFAULT_INFRASTRUCTURE_CONFIG;
        }
        cache_timestamp = Date.now();
        return cached_config;
    }
    catch (_a) {
        // On error, use defaults
        return exports.DEFAULT_INFRASTRUCTURE_CONFIG;
    }
}
/**
 * Invalidates the config cache.
 * Useful for testing or after config updates.
 */
function invalidate_config_cache() {
    cached_config = null;
    cache_timestamp = 0;
}
//# sourceMappingURL=config.js.map