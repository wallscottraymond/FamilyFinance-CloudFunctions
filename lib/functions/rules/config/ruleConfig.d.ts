/**
 * Rule Configuration - Constants and settings for the Rules system
 *
 * Central configuration for all rules-related functionality.
 * Modify these values to tune system behavior.
 */
/**
 * Core rule configuration
 */
export declare const RULE_CONFIG: {
    /** Maximum number of rules per user */
    readonly MAX_RULES_PER_USER: 100;
    /** Maximum condition groups per rule */
    readonly MAX_CONDITION_GROUPS: 10;
    /** Maximum conditions per group */
    readonly MAX_CONDITIONS_PER_GROUP: 20;
    /** Maximum nesting depth for condition groups */
    readonly MAX_NESTED_DEPTH: 3;
    /** Maximum actions per rule */
    readonly MAX_ACTIONS_PER_RULE: 5;
    /** Timeout for rule evaluation (milliseconds) */
    readonly RULE_EVALUATION_TIMEOUT_MS: 5000;
    /** Batch size for processing transactions */
    readonly BATCH_SIZE: 100;
    /** Cache TTL for rule evaluations (minutes) */
    readonly CACHE_TTL_MINUTES: 60;
    /** Cache TTL in milliseconds */
    readonly CACHE_TTL_MS: number;
    /** Enable evaluation caching */
    readonly ENABLE_CACHE: true;
    /** Batch size for retroactive rule application */
    readonly RETROACTIVE_BATCH_SIZE: 50;
    /** Delay between batches (milliseconds) */
    readonly RETROACTIVE_DELAY_MS: 100;
    /** Maximum transactions to process retroactively */
    readonly MAX_RETROACTIVE_TRANSACTIONS: 10000;
    /** Enable retroactive application by default */
    readonly ENABLE_RETROACTIVE_BY_DEFAULT: true;
    /** Default priority for new rules */
    readonly DEFAULT_PRIORITY: 100;
    /** Minimum priority value */
    readonly MIN_PRIORITY: 1;
    /** Maximum priority value */
    readonly MAX_PRIORITY: 999;
    /** Priority threshold for "critical" rules (apply first, stop after) */
    readonly CRITICAL_PRIORITY_THRESHOLD: 900;
    /** Sample size for rule testing */
    readonly TEST_MODE_SAMPLE_SIZE: 100;
    /** Maximum transactions to show in preview */
    readonly PREVIEW_LIMIT: 50;
    /** Enable detailed evaluation logging in test mode */
    readonly TEST_MODE_VERBOSE_LOGGING: true;
    /** Minimum rule name length */
    readonly MIN_RULE_NAME_LENGTH: 1;
    /** Maximum rule name length */
    readonly MAX_RULE_NAME_LENGTH: 100;
    /** Maximum description length */
    readonly MAX_DESCRIPTION_LENGTH: 500;
    /** Require at least one condition */
    readonly REQUIRE_CONDITIONS: true;
    /** Require at least one action */
    readonly REQUIRE_ACTIONS: true;
    /** Default case sensitivity for string conditions */
    readonly DEFAULT_CASE_SENSITIVE: false;
    /** Maximum regex pattern length */
    readonly MAX_REGEX_LENGTH: 200;
    /** Timeout for regex evaluation (milliseconds) */
    readonly REGEX_TIMEOUT_MS: 1000;
    /** Rate limit: Max rule creations per hour */
    readonly MAX_RULE_CREATIONS_PER_HOUR: 10;
    /** Rate limit: Max rule updates per hour */
    readonly MAX_RULE_UPDATES_PER_HOUR: 20;
    /** Rate limit: Max rule tests per hour */
    readonly MAX_RULE_TESTS_PER_HOUR: 50;
    /** Rate limit: Max rule previews per hour */
    readonly MAX_RULE_PREVIEWS_PER_HOUR: 100;
    /** Rate limit: Max rule applications per hour */
    readonly MAX_RULE_APPLICATIONS_PER_HOUR: 20;
    /** Rate limit: Max rule reverts per hour */
    readonly MAX_RULE_REVERTS_PER_HOUR: 10;
    /** Keep rule application history (subcollection) */
    readonly ENABLE_HISTORY: true;
    /** Maximum history entries per transaction */
    readonly MAX_HISTORY_ENTRIES_PER_TRANSACTION: 100;
    /** History retention period (days) */
    readonly HISTORY_RETENTION_DAYS: 365;
    /** Archive history older than retention period */
    readonly AUTO_ARCHIVE_OLD_HISTORY: true;
    /** Enable automatic conflict detection */
    readonly ENABLE_CONFLICT_DETECTION: true;
    /** Warn user about conflicts */
    readonly WARN_ON_CONFLICTS: true;
    /** Auto-resolve conflicts using priority */
    readonly AUTO_RESOLVE_CONFLICTS: true;
    /** Maximum retries for failed rule applications */
    readonly MAX_RETRIES: 3;
    /** Retry delay (milliseconds) */
    readonly RETRY_DELAY_MS: 1000;
    /** Continue on error (don't stop batch processing) */
    readonly CONTINUE_ON_ERROR: true;
    /** Log detailed error information */
    readonly VERBOSE_ERROR_LOGGING: true;
    /** Enable performance monitoring */
    readonly ENABLE_MONITORING: true;
    /** Slow evaluation threshold (milliseconds) */
    readonly SLOW_EVALUATION_THRESHOLD_MS: 1000;
    /** High error rate threshold (percentage) */
    readonly HIGH_ERROR_RATE_THRESHOLD: 0.05;
    /** Alert on high match count */
    readonly HIGH_MATCH_COUNT_THRESHOLD: 10000;
    /** Enable rules system globally */
    readonly RULES_ENABLED: true;
    /** Enable family-shared rules (future feature) */
    readonly ENABLE_FAMILY_RULES: false;
    /** Enable rule templates/presets (future feature) */
    readonly ENABLE_RULE_TEMPLATES: false;
    /** Enable ML-based rule suggestions (future feature) */
    readonly ENABLE_ML_SUGGESTIONS: false;
    /** Enable split modification rules (future feature) */
    readonly ENABLE_SPLIT_RULES: false;
    /** Enable budget assignment rules (future feature) */
    readonly ENABLE_BUDGET_RULES: false;
    /** Use short-circuit evaluation (stop on first match for OR, first false for AND) */
    readonly USE_SHORT_CIRCUIT_EVALUATION: true;
    /** Evaluate high-priority rules first */
    readonly PRIORITY_BASED_EVALUATION: true;
    /** Use parallel evaluation for independent condition groups */
    readonly USE_PARALLEL_EVALUATION: false;
    /** Pre-compile regex patterns */
    readonly PRECOMPILE_REGEX: true;
};
/**
 * Rule priority levels (convenience constants)
 */
export declare const RULE_PRIORITY: {
    /** Critical priority - applies first, stops after match */
    readonly CRITICAL: 900;
    /** Very high priority */
    readonly VERY_HIGH: 800;
    /** High priority */
    readonly HIGH: 700;
    /** Above normal priority */
    readonly ABOVE_NORMAL: 600;
    /** Normal priority (default) */
    readonly NORMAL: 500;
    /** Below normal priority */
    readonly BELOW_NORMAL: 400;
    /** Low priority */
    readonly LOW: 300;
    /** Very low priority */
    readonly VERY_LOW: 200;
    /** Minimal priority - applies last */
    readonly MINIMAL: 100;
};
/**
 * Rule evaluation result codes
 */
export declare const RULE_RESULT: {
    readonly MATCH: "match";
    readonly NO_MATCH: "no_match";
    readonly ERROR: "error";
    readonly TIMEOUT: "timeout";
    readonly SKIPPED: "skipped";
};
/**
 * Rule application status
 */
export declare const RULE_STATUS: {
    readonly PENDING: "pending";
    readonly PROCESSING: "processing";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly PARTIAL: "partial";
};
/**
 * Conflict types
 */
export declare const CONFLICT_TYPE: {
    readonly CATEGORY: "category";
    readonly TAG: "tag";
    readonly BUDGET: "budget";
    readonly PRIORITY: "priority";
    readonly CONDITION: "condition";
};
/**
 * Rule source types
 */
export declare const RULE_SOURCE: {
    readonly USER: "user";
    readonly TEMPLATE: "template";
    readonly ML: "ml";
    readonly FAMILY: "family";
    readonly SYSTEM: "system";
};
export type RulePriority = typeof RULE_PRIORITY[keyof typeof RULE_PRIORITY];
export type RuleResult = typeof RULE_RESULT[keyof typeof RULE_RESULT];
export type RuleStatus = typeof RULE_STATUS[keyof typeof RULE_STATUS];
export type ConflictType = typeof CONFLICT_TYPE[keyof typeof CONFLICT_TYPE];
export type RuleSource = typeof RULE_SOURCE[keyof typeof RULE_SOURCE];
//# sourceMappingURL=ruleConfig.d.ts.map