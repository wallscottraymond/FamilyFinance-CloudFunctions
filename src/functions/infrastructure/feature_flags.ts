/**
 * Feature Flags
 *
 * Provides feature flag management for gradual rollouts and A/B testing.
 * Flags are stored in Firestore and cached in memory for performance.
 *
 * @module infrastructure/feature_flags
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Collection for feature flags.
 */
const COLLECTION = "_feature_flags";

/**
 * Feature flag definition.
 */
export interface FeatureFlag {
  /** Flag name/key */
  name: string;

  /** Whether the flag is enabled globally */
  enabled: boolean;

  /** Percentage rollout (0-100, only applies if enabled) */
  rollout_percentage: number;

  /** Specific user IDs that have this flag enabled */
  enabled_user_ids: string[];

  /** Specific group IDs that have this flag enabled */
  enabled_group_ids: string[];

  /** Description of the flag */
  description?: string;

  /** When the flag was created */
  created_at: Timestamp;

  /** When the flag was last updated */
  updated_at: Timestamp;
}

/**
 * In-memory cache for feature flags.
 */
interface FlagCache {
  flags: Map<string, FeatureFlag>;
  loaded_at: number;
  ttl_ms: number;
}

/**
 * Global flag cache.
 */
let flag_cache: FlagCache | null = null;

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
export async function load_feature_flags(force_reload = false): Promise<void> {
  // Check if cache is still valid
  if (!force_reload && flag_cache) {
    const elapsed = Date.now() - flag_cache.loaded_at;
    if (elapsed < flag_cache.ttl_ms) {
      return;
    }
  }

  const db = getFirestore();
  const snapshot = await db.collection(COLLECTION).get();

  const flags = new Map<string, FeatureFlag>();
  snapshot.docs.forEach((doc) => {
    const flag = doc.data() as FeatureFlag;
    flags.set(doc.id, { ...flag, name: doc.id });
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
export async function get_feature_flag(
  flag_name: string
): Promise<FeatureFlag | null> {
  await load_feature_flags();

  if (!flag_cache) {
    return null;
  }

  return flag_cache.flags.get(flag_name) ?? null;
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
export async function is_flag_enabled(
  flag_name: string,
  context?: {
    user_id?: string;
    group_ids?: string[];
  }
): Promise<boolean> {
  const flag = await get_feature_flag(flag_name);

  // Flag doesn't exist or is globally disabled
  if (!flag || !flag.enabled) {
    return false;
  }

  // Check user-specific enablement
  if (context?.user_id && flag.enabled_user_ids.includes(context.user_id)) {
    return true;
  }

  // Check group-specific enablement
  if (context?.group_ids) {
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
  if (context?.user_id) {
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
export async function set_feature_flag(
  flag_name: string,
  settings: Partial<Omit<FeatureFlag, "name" | "created_at" | "updated_at">>
): Promise<void> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(flag_name);
  const now = Timestamp.now();

  const doc = await doc_ref.get();

  if (doc.exists) {
    // Update existing
    await doc_ref.update({
      ...settings,
      updated_at: now,
    });
  } else {
    // Create new
    const new_flag: Omit<FeatureFlag, "name"> = {
      enabled: false,
      rollout_percentage: 0,
      enabled_user_ids: [],
      enabled_group_ids: [],
      created_at: now,
      updated_at: now,
      ...settings,
    };
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
export async function delete_feature_flag(flag_name: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTION).doc(flag_name).delete();

  // Invalidate cache
  flag_cache = null;
}

/**
 * Lists all feature flags.
 *
 * @returns Array of all feature flags
 */
export async function list_feature_flags(): Promise<FeatureFlag[]> {
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
export function invalidate_flag_cache(): void {
  flag_cache = null;
}

/**
 * Simple hash function to convert a string to a percentage (0-99).
 * Used for deterministic rollout assignment.
 */
function hash_to_percentage(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % 100;
}
