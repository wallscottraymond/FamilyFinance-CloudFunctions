/**
 * Cleanup Idempotency Orchestrator
 *
 * Coordinates the cleanup of expired idempotency records.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_idempotency
 */
import { TraceContext } from "../../types";
/**
 * Result of the cleanup operation.
 */
export interface CleanupIdempotencyResult {
    total_deleted: number;
    batches_processed: number;
    completed: boolean;
}
/**
 * Configuration for cleanup operation.
 */
export interface CleanupIdempotencyConfig {
    /** Maximum records to delete per batch (default: 500) */
    batch_size?: number;
    /** Maximum batches to process (safety limit, default: 20) */
    max_batches?: number;
}
/**
 * Orchestrates the cleanup of expired idempotency records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
export declare function cleanup_idempotency(ctx: TraceContext, config?: CleanupIdempotencyConfig): Promise<CleanupIdempotencyResult>;
//# sourceMappingURL=cleanup_idempotency.orchestrator.d.ts.map