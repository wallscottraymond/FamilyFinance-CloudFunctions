"use strict";
/**
 * Rule Configuration - Constants and settings for the Rules system
 *
 * Central configuration for all rules-related functionality.
 * Modify these values to tune system behavior.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RULE_SOURCE = exports.CONFLICT_TYPE = exports.RULE_STATUS = exports.RULE_RESULT = exports.RULE_PRIORITY = exports.RULE_CONFIG = void 0;
/**
 * Core rule configuration
 */
exports.RULE_CONFIG = {
    // ============================================================================
    // RULE LIMITS
    // ============================================================================
    /** Maximum number of rules per user */
    MAX_RULES_PER_USER: 100,
    /** Maximum condition groups per rule */
    MAX_CONDITION_GROUPS: 10,
    /** Maximum conditions per group */
    MAX_CONDITIONS_PER_GROUP: 20,
    /** Maximum nesting depth for condition groups */
    MAX_NESTED_DEPTH: 3,
    /** Maximum actions per rule */
    MAX_ACTIONS_PER_RULE: 5,
    // ============================================================================
    // PERFORMANCE
    // ============================================================================
    /** Timeout for rule evaluation (milliseconds) */
    RULE_EVALUATION_TIMEOUT_MS: 5000,
    /** Batch size for processing transactions */
    BATCH_SIZE: 100,
    /** Cache TTL for rule evaluations (minutes) */
    CACHE_TTL_MINUTES: 60,
    /** Cache TTL in milliseconds */
    CACHE_TTL_MS: 60 * 60 * 1000, // 1 hour
    /** Enable evaluation caching */
    ENABLE_CACHE: true,
    // ============================================================================
    // RETROACTIVE APPLICATION
    // ============================================================================
    /** Batch size for retroactive rule application */
    RETROACTIVE_BATCH_SIZE: 50,
    /** Delay between batches (milliseconds) */
    RETROACTIVE_DELAY_MS: 100,
    /** Maximum transactions to process retroactively */
    MAX_RETROACTIVE_TRANSACTIONS: 10000,
    /** Enable retroactive application by default */
    ENABLE_RETROACTIVE_BY_DEFAULT: true,
    // ============================================================================
    // PRIORITY
    // ============================================================================
    /** Default priority for new rules */
    DEFAULT_PRIORITY: 100,
    /** Minimum priority value */
    MIN_PRIORITY: 1,
    /** Maximum priority value */
    MAX_PRIORITY: 999,
    /** Priority threshold for "critical" rules (apply first, stop after) */
    CRITICAL_PRIORITY_THRESHOLD: 900,
    // ============================================================================
    // TESTING & PREVIEW
    // ============================================================================
    /** Sample size for rule testing */
    TEST_MODE_SAMPLE_SIZE: 100,
    /** Maximum transactions to show in preview */
    PREVIEW_LIMIT: 50,
    /** Enable detailed evaluation logging in test mode */
    TEST_MODE_VERBOSE_LOGGING: true,
    // ============================================================================
    // VALIDATION
    // ============================================================================
    /** Minimum rule name length */
    MIN_RULE_NAME_LENGTH: 1,
    /** Maximum rule name length */
    MAX_RULE_NAME_LENGTH: 100,
    /** Maximum description length */
    MAX_DESCRIPTION_LENGTH: 500,
    /** Require at least one condition */
    REQUIRE_CONDITIONS: true,
    /** Require at least one action */
    REQUIRE_ACTIONS: true,
    // ============================================================================
    // STRING MATCHING
    // ============================================================================
    /** Default case sensitivity for string conditions */
    DEFAULT_CASE_SENSITIVE: false,
    /** Maximum regex pattern length */
    MAX_REGEX_LENGTH: 200,
    /** Timeout for regex evaluation (milliseconds) */
    REGEX_TIMEOUT_MS: 1000,
    // ============================================================================
    // RATE LIMITING
    // ============================================================================
    /** Rate limit: Max rule creations per hour */
    MAX_RULE_CREATIONS_PER_HOUR: 10,
    /** Rate limit: Max rule updates per hour */
    MAX_RULE_UPDATES_PER_HOUR: 20,
    /** Rate limit: Max rule tests per hour */
    MAX_RULE_TESTS_PER_HOUR: 50,
    /** Rate limit: Max rule previews per hour */
    MAX_RULE_PREVIEWS_PER_HOUR: 100,
    /** Rate limit: Max rule applications per hour */
    MAX_RULE_APPLICATIONS_PER_HOUR: 20,
    /** Rate limit: Max rule reverts per hour */
    MAX_RULE_REVERTS_PER_HOUR: 10,
    // ============================================================================
    // HISTORY & AUDIT
    // ============================================================================
    /** Keep rule application history (subcollection) */
    ENABLE_HISTORY: true,
    /** Maximum history entries per transaction */
    MAX_HISTORY_ENTRIES_PER_TRANSACTION: 100,
    /** History retention period (days) */
    HISTORY_RETENTION_DAYS: 365,
    /** Archive history older than retention period */
    AUTO_ARCHIVE_OLD_HISTORY: true,
    // ============================================================================
    // CONFLICT DETECTION
    // ============================================================================
    /** Enable automatic conflict detection */
    ENABLE_CONFLICT_DETECTION: true,
    /** Warn user about conflicts */
    WARN_ON_CONFLICTS: true,
    /** Auto-resolve conflicts using priority */
    AUTO_RESOLVE_CONFLICTS: true,
    // ============================================================================
    // ERROR HANDLING
    // ============================================================================
    /** Maximum retries for failed rule applications */
    MAX_RETRIES: 3,
    /** Retry delay (milliseconds) */
    RETRY_DELAY_MS: 1000,
    /** Continue on error (don't stop batch processing) */
    CONTINUE_ON_ERROR: true,
    /** Log detailed error information */
    VERBOSE_ERROR_LOGGING: true,
    // ============================================================================
    // MONITORING & ALERTING
    // ============================================================================
    /** Enable performance monitoring */
    ENABLE_MONITORING: true,
    /** Slow evaluation threshold (milliseconds) */
    SLOW_EVALUATION_THRESHOLD_MS: 1000,
    /** High error rate threshold (percentage) */
    HIGH_ERROR_RATE_THRESHOLD: 0.05, // 5%
    /** Alert on high match count */
    HIGH_MATCH_COUNT_THRESHOLD: 10000,
    // ============================================================================
    // FEATURES FLAGS
    // ============================================================================
    /** Enable rules system globally */
    RULES_ENABLED: true,
    /** Enable family-shared rules (future feature) */
    ENABLE_FAMILY_RULES: false,
    /** Enable rule templates/presets (future feature) */
    ENABLE_RULE_TEMPLATES: false,
    /** Enable ML-based rule suggestions (future feature) */
    ENABLE_ML_SUGGESTIONS: false,
    /** Enable split modification rules (future feature) */
    ENABLE_SPLIT_RULES: false,
    /** Enable budget assignment rules (future feature) */
    ENABLE_BUDGET_RULES: false,
    // ============================================================================
    // OPTIMIZATION
    // ============================================================================
    /** Use short-circuit evaluation (stop on first match for OR, first false for AND) */
    USE_SHORT_CIRCUIT_EVALUATION: true,
    /** Evaluate high-priority rules first */
    PRIORITY_BASED_EVALUATION: true,
    /** Use parallel evaluation for independent condition groups */
    USE_PARALLEL_EVALUATION: false, // Future optimization
    /** Pre-compile regex patterns */
    PRECOMPILE_REGEX: true,
};
/**
 * Rule priority levels (convenience constants)
 */
exports.RULE_PRIORITY = {
    /** Critical priority - applies first, stops after match */
    CRITICAL: 900,
    /** Very high priority */
    VERY_HIGH: 800,
    /** High priority */
    HIGH: 700,
    /** Above normal priority */
    ABOVE_NORMAL: 600,
    /** Normal priority (default) */
    NORMAL: 500,
    /** Below normal priority */
    BELOW_NORMAL: 400,
    /** Low priority */
    LOW: 300,
    /** Very low priority */
    VERY_LOW: 200,
    /** Minimal priority - applies last */
    MINIMAL: 100,
};
/**
 * Rule evaluation result codes
 */
exports.RULE_RESULT = {
    MATCH: 'match',
    NO_MATCH: 'no_match',
    ERROR: 'error',
    TIMEOUT: 'timeout',
    SKIPPED: 'skipped',
};
/**
 * Rule application status
 */
exports.RULE_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    PARTIAL: 'partial',
};
/**
 * Conflict types
 */
exports.CONFLICT_TYPE = {
    CATEGORY: 'category', // Multiple rules setting category
    TAG: 'tag', // Conflicting tag operations
    BUDGET: 'budget', // Multiple rules setting budget
    PRIORITY: 'priority', // Same priority rules with conflicts
    CONDITION: 'condition', // Overlapping/contradictory conditions
};
/**
 * Rule source types
 */
exports.RULE_SOURCE = {
    USER: 'user', // User-created rule
    TEMPLATE: 'template', // From template/preset
    ML: 'ml', // ML-suggested rule
    FAMILY: 'family', // Family-shared rule
    SYSTEM: 'system', // System-generated rule
};
//# sourceMappingURL=ruleConfig.js.map