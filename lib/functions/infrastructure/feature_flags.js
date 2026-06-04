"use strict";
/**
 * Feature Flags
 *
 * Provides feature flag management for gradual rollouts and A/B testing.
 * Flags are stored in Firestore and cached in memory for performance.
 *
 * @module infrastructure/feature_flags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.load_feature_flags = load_feature_flags;
exports.get_feature_flag = get_feature_flag;
exports.is_flag_enabled = is_flag_enabled;
exports.set_feature_flag = set_feature_flag;
exports.delete_feature_flag = delete_feature_flag;
exports.list_feature_flags = list_feature_flags;
exports.invalidate_flag_cache = invalidate_flag_cache;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection for feature flags.
 */
const COLLECTION = "_feature_flags";
/**
 * Global flag cache.
 */
let flag_cache = null;
/**
 * Default cache TTL (5 minutes).
 */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Loads all feature flags from Firestore.
 * Results are cached in memory.
 *
 * @param force_reload - Force reload even if cache is valid
 */
async function load_feature_flags(force_reload = false) {
    // Check if cache is still valid
    if (!force_reload && flag_cache) {
        const elapsed = Date.now() - flag_cache.loaded_at;
        if (elapsed < flag_cache.ttl_ms) {
            return;
        }
    }
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db.collection(COLLECTION).get();
    const flags = new Map();
    snapshot.docs.forEach((doc) => {
        const flag = doc.data();
        flags.set(doc.id, Object.assign(Object.assign({}, flag), { name: doc.id }));
    });
    flag_cache = {
        flags,
        loaded_at: Date.now(),
        ttl_ms: DEFAULT_CACHE_TTL_MS,
    };
}
/**
 * Gets a feature flag by name.
 *
 * @param flag_name - Name of the flag
 * @returns The feature flag or null if not found
 */
async function get_feature_flag(flag_name) {
    var _a;
    await load_feature_flags();
    if (!flag_cache) {
        return null;
    }
    return (_a = flag_cache.flags.get(flag_name)) !== null && _a !== void 0 ? _a : null;
}
/**
 * Checks if a feature flag is enabled for a given context.
 *
 * Evaluation order:
 * 1. If flag doesn't exist or is globally disabled, return false
 * 2. If user_id is in enabled_user_ids, return true
 * 3. If any group_id is in enabled_group_ids, return true
 * 4. Check rollout percentage based on user_id hash
 *
 * @param flag_name - Name of the flag
 * @param context - User/group context
 * @returns Whether the flag is enabled
 *
 * @example
 * if (await is_flag_enabled("new_budget_ui", { user_id: "abc123" })) {
 *   // Use new UI
 * }
 */
async function is_flag_enabled(flag_name, context) {
    const flag = await get_feature_flag(flag_name);
    // Flag doesn't exist or is globally disabled
    if (!flag || !flag.enabled) {
        return false;
    }
    // Check user-specific enablement
    if ((context === null || context === void 0 ? void 0 : context.user_id) && flag.enabled_user_ids.includes(context.user_id)) {
        return true;
    }
    // Check group-specific enablement
    if (context === null || context === void 0 ? void 0 : context.group_ids) {
        for (const group_id of context.group_ids) {
            if (flag.enabled_group_ids.includes(group_id)) {
                return true;
            }
        }
    }
    // Check rollout percentage
    if (flag.rollout_percentage >= 100) {
        return true;
    }
    if (flag.rollout_percentage <= 0) {
        return false;
    }
    // Use user_id to deterministically assign to rollout bucket
    if (context === null || context === void 0 ? void 0 : context.user_id) {
        const bucket = hash_to_percentage(context.user_id + flag_name);
        return bucket < flag.rollout_percentage;
    }
    // No user context and partial rollout - default to false
    return false;
}
/**
 * Creates or updates a feature flag.
 *
 * @param flag_name - Name of the flag
 * @param settings - Flag settings
 */
async function set_feature_flag(flag_name, settings) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(flag_name);
    const now = firestore_1.Timestamp.now();
    const doc = await doc_ref.get();
    if (doc.exists) {
        // Update existing
        await doc_ref.update(Object.assign(Object.assign({}, settings), { updated_at: now }));
    }
    else {
        // Create new
        const new_flag = Object.assign({ enabled: false, rollout_percentage: 0, enabled_user_ids: [], enabled_group_ids: [], created_at: now, updated_at: now }, settings);
        await doc_ref.set(new_flag);
    }
    // Invalidate cache
    flag_cache = null;
}
/**
 * Deletes a feature flag.
 *
 * @param flag_name - Name of the flag to delete
 */
async function delete_feature_flag(flag_name) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTION).doc(flag_name).delete();
    // Invalidate cache
    flag_cache = null;
}
/**
 * Lists all feature flags.
 *
 * @returns Array of all feature flags
 */
async function list_feature_flags() {
    await load_feature_flags(true);
    if (!flag_cache) {
        return [];
    }
    return Array.from(flag_cache.flags.values());
}
/**
 * Invalidates the feature flag cache.
 * Useful after external updates.
 */
function invalidate_flag_cache() {
    flag_cache = null;
}
/**
 * Simple hash function to convert a string to a percentage (0-99).
 * Used for deterministic rollout assignment.
 */
function hash_to_percentage(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 100;
}
//# sourceMappingURL=feature_flags.js.map