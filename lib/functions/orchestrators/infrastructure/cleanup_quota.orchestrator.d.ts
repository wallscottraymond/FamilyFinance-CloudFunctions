/**
 * Cleanup Quota Orchestrator
 *
 * Coordinates the cleanup of old quota tracking and snapshot data.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_quota
 */
import { TraceContext } from "../../types";
/**
 * Result of the cleanup operation.
 */
export interface CleanupQuotaResult {
    tracking_deleted: number;
    snapshots_deleted: number;
    total_deleted: number;
}
/**
 * Configuration for cleanup operation.
 */
export interface CleanupQuotaConfig {
    /** Retention period in days (default: 30) */
    retention_days?: number;
    /** Maximum records to delete per batch (default: 500) */
    batch_size?: number;
    /** Maximum batches to process (safety limit, default: 10) */
    max_batches?: number;
}
/**
 * Orchestrates the cleanup of old quota data.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
export declare function cleanup_quota(ctx: TraceContext, config?: CleanupQuotaConfig): Promise<CleanupQuotaResult>;
//# sourceMappingURL=cleanup_quota.orchestrator.d.ts.map