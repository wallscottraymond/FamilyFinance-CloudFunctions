/**
 * Purge Soft Deleted Orchestrator
 *
 * Coordinates the permanent deletion of soft-deleted records.
 * Handles batched deletion across multiple collections.
 *
 * @module orchestrator/infrastructure/purge_soft_deleted
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  create_child_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import {
  SOFT_DELETE_COLLECTIONS,
  purge_deleted_records,
} from "../../repositories/infrastructure";
import { get_infrastructure_config } from "../../infrastructure/config";

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
 * Purges soft-deleted records from a single collection.
 */
async function purge_collection(
  ctx: TraceContext,
  collection: string,
  cutoff: Timestamp,
  batch_size: number,
  max_batches: number
): Promise<CollectionPurgeResult> {
  let total_purged = 0;
  let batches_processed = 0;
  let batch_purged = 0;

  do {
    const batch_ctx = create_child_span(ctx);
    const result = await purge_deleted_records(
      batch_ctx,
      collection,
      cutoff,
      batch_size
    );

    batch_purged = result.purged_count;
    total_purged += batch_purged;
    batches_processed++;
  } while (batch_purged === batch_size && batches_processed < max_batches);

  return {
    collection,
    purged_count: total_purged,
    batches_processed,
  };
}

/**
 * Orchestrates the permanent deletion of soft-deleted records.
 *
 * @param ctx - Trace context
 * @param config - Purge configuration
 * @returns Purge result
 */
export async function purge_soft_deleted(
  ctx: TraceContext,
  config?: PurgeSoftDeletedConfig
): Promise<PurgeSoftDeletedResult> {
  const span = create_span(ctx, "orchestrator", "purge_soft_deleted");
  log_operation_start(span);

  // Get configuration from centralized config
  const infra_config = await get_infrastructure_config();

  const retention_days = config?.retention_days ?? infra_config.soft_delete_retention_days;
  const batch_size = config?.batch_size ?? infra_config.cleanup_batch_size;
  const max_batches = config?.max_batches ?? infra_config.cleanup_max_batches;
  const collections = config?.collections ?? SOFT_DELETE_COLLECTIONS;

  const cutoff = Timestamp.fromMillis(
    Date.now() - retention_days * 24 * 60 * 60 * 1000
  );

  try {
    const results: CollectionPurgeResult[] = [];
    let total_purged = 0;

    for (const collection of collections) {
      const result = await purge_collection(
        ctx,
        collection,
        cutoff,
        batch_size,
        max_batches
      );

      results.push(result);
      total_purged += result.purged_count;

      if (result.purged_count > 0) {
        fire_and_forget(() => log_async_debug({
          trace_id: ctx.trace_id,
          span_id: span.span_id,
          layer: "orchestrator",
          function: "purge_soft_deleted",
          status: "collection_complete",
          context: {
            collection: result.collection,
            purged_count: result.purged_count,
            batches_processed: result.batches_processed,
          },
        }));
      }
    }

    log_operation_success(span);

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "purge_soft_deleted",
      status: "success",
      output: {
        total_purged,
        collections_processed: collections.length,
        retention_days,
      },
    }));

    return {
      collections: results,
      total_purged,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { error_code: "PURGE_SOFT_DELETED_FAILED" }
    );
    throw error;
  }
}
