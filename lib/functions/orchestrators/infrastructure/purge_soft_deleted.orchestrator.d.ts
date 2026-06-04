/**
 * Purge Soft Deleted Orchestrator
 *
 * Coordinates the permanent deletion of soft-deleted records.
 * Handles batched deletion across multiple collections.
 *
 * @module orchestrator/infrastructure/purge_soft_deleted
 */
import { TraceContext } from "../../types";
/**
 * Result of purging a single collection.
 */
export interface CollectionPurgeResult {
    collection: string;
    purged_count: number;
    batches_processed: number;
}
/**
 * Result of the full purge operation.
 */
export interface PurgeSoftDeletedResult {
    collections: CollectionPurgeResult[];
    total_purged: number;
}
/**
 * Configuration for purge operation.
 */
export interface PurgeSoftDeletedConfig {
    /** Retention period in days (default: 30) */
    retention_days?: number;
    /** Maximum records to delete per batch (default: 500) */
    batch_size?: number;
    /** Maximum batches per collection (safety limit, default: 10) */
    max_batches?: number;
    /** Collections to purge (default: all soft-delete collections) */
    collections?: readonly string[];
}
/**
 * Orchestrates the permanent deletion of soft-deleted records.
 *
 * @param ctx - Trace context
 * @param config - Purge configuration
 * @returns Purge result
 */
export declare function purge_soft_deleted(ctx: TraceContext, config?: PurgeSoftDeletedConfig): Promise<PurgeSoftDeletedResult>;
//# sourceMappingURL=purge_soft_deleted.orchestrator.d.ts.map