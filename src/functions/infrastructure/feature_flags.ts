/**
 * Feature Flags
 *
 * Provides feature flag management for gradual rollouts and A/B testing.
 * Flags are stored in Firestore and cached in memory for performance.
 *
 * @module infrastructure/feature_flags
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { CONVERT_TO_RECURRING_FLAG } from "../domain/recurring/capture_rules";

/** The production flag collection. */
export const FEATURE_FLAGS_COLLECTION = "_feature_flags";

/**
 * Collection for feature flags. The override exists ONLY for the emulator suites (each test file
 * gets its own flag collection, so parallel suites can't clobber one global flag doc). It is
 * honored ONLY when `FIRESTORE_EMULATOR_HOST` is set (hardening, review round 3 defect 7): a stray
 * override in a deployed function's environment can never redirect the real flag read.
 */
export function feature_flags_collection(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FEATURE_FLAGS_COLLECTION_OVERRIDE;
  return override && env.FIRESTORE_EMULATOR_HOST ? override : FEATURE_FLAGS_COLLECTION;
}

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

/** The shared in-flight cold load (single-flight), or null when no load is running. */
let flag_load_in_flight: Promise<void> | null = null;

/** Bumped on every invalidation, so a load that started before it can't repopulate the cache. */
let flag_cache_generation = 0;

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

  // Single-flight (Convert-To-Recurring round 4, defect 3): concurrent cold callers (e.g. a group
  // derive resolving the flag for every member at once) share ONE in-flight read instead of each
  // reading the whole collection. A forced reload always starts its own read.
  if (!force_reload && flag_load_in_flight) {
    return flag_load_in_flight;
  }

  const generation = flag_cache_generation;
  const load = (async () => {
    const db = getFirestore();
    const snapshot = await db.collection(feature_flags_collection()).get();

    const flags = new Map<string, FeatureFlag>();
    snapshot.docs.forEach((doc) => {
      const flag = doc.data() as FeatureFlag;
      flags.set(doc.id, { ...flag, name: doc.id });
    });

    // An invalidation that landed while this read was in flight wins: don't repopulate the cache
    // with a possibly pre-write snapshot.
    if (generation === flag_cache_generation) {
      flag_cache = {
        flags,
        loaded_at: Date.now(),
        ttl_ms: DEFAULT_CACHE_TTL_MS,
      };
    }
  })();

  if (force_reload) {
    await load;
    return;
  }

  flag_load_in_flight = load;
  try {
    await load;
  } finally {
    if (flag_load_in_flight === load) flag_load_in_flight = null;
  }
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
  // Hardened (Convert-To-Recurring X18): a flag doc missing a field, a malformed field, or a
  // failed flag read must never throw into a caller (sync, derive) — every problem reads as OFF.
  let flag: FeatureFlag | null;
  try {
    flag = await get_feature_flag(flag_name);
  } catch (error) {
    console.warn(`[feature_flags] flag ${flag_name} could not be read; treating as off:`, error);
    return false;
  }

  // Flag doesn't exist or is globally disabled
  if (!flag || flag.enabled !== true) {
    return false;
  }

  const user_ids = Array.isArray(flag.enabled_user_ids) ? flag.enabled_user_ids : [];
  const group_ids = Array.isArray(flag.enabled_group_ids) ? flag.enabled_group_ids : [];
  const rollout = typeof flag.rollout_percentage === "number" ? flag.rollout_percentage : 0;

  // Check user-specific enablement
  if (context?.user_id && user_ids.includes(context.user_id)) {
    return true;
  }

  // Check group-specific enablement
  if (Array.isArray(context?.group_ids)) {
    for (const group_id of context!.group_ids!) {
      if (group_ids.includes(group_id)) {
        return true;
      }
    }
  }

  // Check rollout percentage
  if (rollout >= 100) {
    return true;
  }

  if (rollout <= 0) {
    return false;
  }

  // Use user_id to deterministically assign to rollout bucket
  if (context?.user_id) {
    const bucket = hash_to_percentage(context.user_id + flag_name);
    return bucket < rollout;
  }

  // No user context and partial rollout - default to false
  return false;
}

/**
 * Is the Convert-To-Recurring capture-rules flag on for this user? (`_feature_flags/
 * convert_to_recurring_v1`, owner allowlist.) Never throws; any problem = off. Gates ONLY new
 * stamping, the possible-bill detector and the review-answer callable (X11) — records already
 * stamped v2 keep v2 behavior whatever the flag says (D16).
 */
export async function is_convert_to_recurring_enabled(user_id: string): Promise<boolean> {
  if (!user_id) return false;
  return is_flag_enabled(CONVERT_TO_RECURRING_FLAG, { user_id });
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
  const doc_ref = db.collection(feature_flags_collection()).doc(flag_name);
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
  invalidate_flag_cache();
}

/**
 * Deletes a feature flag.
 *
 * @param flag_name - Name of the flag to delete
 */
export async function delete_feature_flag(flag_name: string): Promise<void> {
  const db = getFirestore();
  await db.collection(feature_flags_collection()).doc(flag_name).delete();

  // Invalidate cache
  invalidate_flag_cache();
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
  flag_load_in_flight = null;
  flag_cache_generation++;
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
