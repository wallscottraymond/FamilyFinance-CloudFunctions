/**
 * Runtime Configuration
 *
 * Provides access to tunable configuration values.
 * Config is stored in Firestore _config collection with in-memory caching.
 *
 * @module infrastructure/config
 */
/**
 * Infrastructure configuration for cleanup operations.
 */
export interface InfrastructureConfig {
    /** Log retention periods in days */
    log_retention: {
        minimal: number;
        debug: number;
        traces: number;
    };
    /** Trigger processing retention in days */
    trigger_retention_days: number;
    /** Soft delete retention before permanent purge (days) */
    soft_delete_retention_days: number;
    /** Idempotency record TTL (milliseconds) */
    idempotency_ttl_ms: number;
    /** Quota monitoring configuration */
    quota: {
        warning_threshold_percent: number;
        critical_threshold_percent: number;
        daily_reads_limit: number;
        daily_writes_limit: number;
    };
    /** Quota data retention in days */
    quota_retention_days: number;
    /** Cleanup batch sizes */
    cleanup_batch_size: number;
    cleanup_max_batches: number;
}
/**
 * Default configuration values.
 * Used when Firestore config is unavailable.
 */
export declare const DEFAULT_INFRASTRUCTURE_CONFIG: InfrastructureConfig;
/**
 * Gets infrastructure configuration.
 * Retrieves from Firestore with caching, falls back to defaults.
 *
 * @returns Infrastructure configuration
 */
export declare function get_infrastructure_config(): Promise<InfrastructureConfig>;
/**
 * Invalidates the config cache.
 * Useful for testing or after config updates.
 */
export declare function invalidate_config_cache(): void;
//# sourceMappingURL=config.d.ts.map