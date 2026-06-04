/**
 * Cleanup Logs Orchestrator
 *
 * Coordinates the cleanup of old log records across all log collections.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_logs
 */
import { TraceContext } from "../../types";
/**
 * Result of cleaning a single collection.
 */
export interface CollectionCleanupResult {
    collection: string;
    deleted_count: number;
    batches_processed: number;
}
/**
 * Result of the full cleanup operation.
 */
export interface CleanupLogsResult {
    minimal: CollectionCleanupResult;
    debug: CollectionCleanupResult;
    traces: CollectionCleanupResult;
    total_deleted: number;
}
/**
 * Configuration for cleanup operation.
 */
export interface CleanupLogsConfig {
    /** Maximum records to delete per batch (default: 500) */
    batch_size?: number;
    /** Maximum batches per collection (safety limit, default: 20) */
    max_batches?: number;
    /** Custom retention periods */
    retention?: {
        minimal_days?: number;
        debug_days?: number;
        traces_days?: number;
    };
}
/**
 * Orchestrates the cleanup of old log records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
export declare function cleanup_logs(ctx: TraceContext, config?: CleanupLogsConfig): Promise<CleanupLogsResult>;
//# sourceMappingURL=cleanup_logs.orchestrator.d.ts.map