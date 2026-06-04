/**
 * Feature Flags
 *
 * Provides feature flag management for gradual rollouts and A/B testing.
 * Flags are stored in Firestore and cached in memory for performance.
 *
 * @module infrastructure/feature_flags
 */
import { Timestamp } from "firebase-admin/firestore";
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
 * Loads all feature flags from Firestore.
 * Results are cached in memory.
 *
 * @param force_reload - Force reload even if cache is valid
 */
export declare function load_feature_flags(force_reload?: boolean): Promise<void>;
/**
 * Gets a feature flag by name.
 *
 * @param flag_name - Name of the flag
 * @returns The feature flag or null if not found
 */
export declare function get_feature_flag(flag_name: string): Promise<FeatureFlag | null>;
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
export declare function is_flag_enabled(flag_name: string, context?: {
    user_id?: string;
    group_ids?: string[];
}): Promise<boolean>;
/**
 * Creates or updates a feature flag.
 *
 * @param flag_name - Name of the flag
 * @param settings - Flag settings
 */
export declare function set_feature_flag(flag_name: string, settings: Partial<Omit<FeatureFlag, "name" | "created_at" | "updated_at">>): Promise<void>;
/**
 * Deletes a feature flag.
 *
 * @param flag_name - Name of the flag to delete
 */
export declare function delete_feature_flag(flag_name: string): Promise<void>;
/**
 * Lists all feature flags.
 *
 * @returns Array of all feature flags
 */
export declare function list_feature_flags(): Promise<FeatureFlag[]>;
/**
 * Invalidates the feature flag cache.
 * Useful after external updates.
 */
export declare function invalidate_flag_cache(): void;
//# sourceMappingURL=feature_flags.d.ts.map