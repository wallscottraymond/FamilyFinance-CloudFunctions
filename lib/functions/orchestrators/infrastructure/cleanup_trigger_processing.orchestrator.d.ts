/**
 * Cleanup Trigger Processing Orchestrator
 *
 * Coordinates the cleanup of old trigger processing records.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_trigger_processing
 */
import { TraceContext } from "../../types";
/**
 * Result of the cleanup operation.
 */
export interface CleanupTriggerProcessingResult {
    total_deleted: number;
    batches_processed: number;
    completed: boolean;
}
/**
 * Configuration for cleanup operation.
 */
export interface CleanupTriggerProcessingConfig {
    /** Retention period in days (default: 7) */
    retention_days?: number;
    /** Maximum records to delete per batch (default: 500) */
    batch_size?: number;
    /** Maximum batches to process (safety limit, default: 20) */
    max_batches?: number;
}
/**
 * Orchestrates the cleanup of old trigger processing records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
export declare function cleanup_trigger_processing(ctx: TraceContext, config?: CleanupTriggerProcessingConfig): Promise<CleanupTriggerProcessingResult>;
//# sourceMappingURL=cleanup_trigger_processing.orchestrator.d.ts.map