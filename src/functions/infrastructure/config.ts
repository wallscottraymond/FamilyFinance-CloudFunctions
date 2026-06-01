/**
 * Runtime Configuration
 *
 * Provides access to tunable configuration values.
 * Config is stored in Firestore _config collection with in-memory caching.
 *
 * @module infrastructure/config
 */

import { getFirestore } from "firebase-admin/firestore";

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
export const DEFAULT_INFRASTRUCTURE_CONFIG: InfrastructureConfig = {
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
    daily_reads_limit: 50_000,
    daily_writes_limit: 20_000,
  },
  quota_retention_days: 30,
  cleanup_batch_size: 500,
  cleanup_max_batches: 20,
};

/**
 * Cached configuration.
 */
let cached_config: InfrastructureConfig | null = null;
let cache_timestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Gets infrastructure configuration.
 * Retrieves from Firestore with caching, falls back to defaults.
 *
 * @returns Infrastructure configuration
 */
export async function get_infrastructure_config(): Promise<InfrastructureConfig> {
  // Return cached if still valid
  if (cached_config && Date.now() - cache_timestamp < CACHE_TTL_MS) {
    return cached_config;
  }

  try {
    const db = getFirestore();
    const doc = await db.collection("_config").doc("infrastructure").get();

    if (doc.exists) {
      const data = doc.data() as Partial<InfrastructureConfig>;
      // Merge with defaults to ensure all fields exist
      cached_config = {
        ...DEFAULT_INFRASTRUCTURE_CONFIG,
        ...data,
        log_retention: {
          ...DEFAULT_INFRASTRUCTURE_CONFIG.log_retention,
          ...data.log_retention,
        },
        quota: {
          ...DEFAULT_INFRASTRUCTURE_CONFIG.quota,
          ...data.quota,
        },
      };
    } else {
      cached_config = DEFAULT_INFRASTRUCTURE_CONFIG;
    }

    cache_timestamp = Date.now();
    return cached_config;
  } catch {
    // On error, use defaults
    return DEFAULT_INFRASTRUCTURE_CONFIG;
  }
}

/**
 * Invalidates the config cache.
 * Useful for testing or after config updates.
 */
export function invalidate_config_cache(): void {
  cached_config = null;
  cache_timestamp = 0;
}
