/**
 * Cleanup Logs Orchestrator
 *
 * Coordinates the cleanup of old log records across all log collections.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_logs
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
  LOG_COLLECTIONS,
  delete_old_log_records,
} from "../../repositories/infrastructure";
import { get_infrastructure_config } from "../../infrastructure/config";

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
 * Cleans up a single log collection.
 */
async function cleanup_collection(
  ctx: TraceContext,
  collection: string,
  retention_days: number,
  batch_size: number,
  max_batches: number
): Promise<CollectionCleanupResult> {
  const cutoff = Timestamp.fromMillis(
    Date.now() - retention_days * 24 * 60 * 60 * 1000
  );

  let total_deleted = 0;
  let batches_processed = 0;
  let batch_deleted = 0;

  do {
    const batch_ctx = create_child_span(ctx);
    const result = await delete_old_log_records(
      batch_ctx,
      collection,
      cutoff,
      batch_size
    );

    batch_deleted = result.deleted_count;
    total_deleted += batch_deleted;
    batches_processed++;
  } while (batch_deleted === batch_size && batches_processed < max_batches);

  return {
    collection,
    deleted_count: total_deleted,
    batches_processed,
  };
}

/**
 * Orchestrates the cleanup of old log records.
 *
 * @param ctx - Trace context
 * @param config - Cleanup configuration
 * @returns Cleanup result
 */
export async function cleanup_logs(
  ctx: TraceContext,
  config?: CleanupLogsConfig
): Promise<CleanupLogsResult> {
  const span = create_span(ctx, "orchestrator", "cleanup_logs");
  log_operation_start(span);

  // Get configuration from centralized config
  const infra_config = await get_infrastructure_config();

  const batch_size = config?.batch_size ?? infra_config.cleanup_batch_size;
  const max_batches = config?.max_batches ?? infra_config.cleanup_max_batches;
  const minimal_days = config?.retention?.minimal_days ?? infra_config.log_retention.minimal;
  const debug_days = config?.retention?.debug_days ?? infra_config.log_retention.debug;
  const traces_days = config?.retention?.traces_days ?? infra_config.log_retention.traces;

  try {
    // Clean up each collection sequentially to avoid overwhelming Firestore
    const minimal = await cleanup_collection(
      ctx,
      LOG_COLLECTIONS.MINIMAL,
      minimal_days,
      batch_size,
      max_batches
    );

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_logs",
      status: "collection_complete",
      context: {
        name: "minimal",
        deleted_count: minimal.deleted_count,
        batches_processed: minimal.batches_processed,
      },
    }));

    const debug = await cleanup_collection(
      ctx,
      LOG_COLLECTIONS.DEBUG,
      debug_days,
      batch_size,
      max_batches
    );

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_logs",
      status: "collection_complete",
      context: {
        name: "debug",
        deleted_count: debug.deleted_count,
        batches_processed: debug.batches_processed,
      },
    }));

    const traces = await cleanup_collection(
      ctx,
      LOG_COLLECTIONS.TRACES,
      traces_days,
      batch_size,
      max_batches
    );

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_logs",
      status: "collection_complete",
      context: {
        name: "traces",
        deleted_count: traces.deleted_count,
        batches_processed: traces.batches_processed,
      },
    }));

    const total_deleted = minimal.deleted_count + debug.deleted_count + traces.deleted_count;

    log_operation_success(span);

    return {
      minimal,
      debug,
      traces,
      total_deleted,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { error_code: "CLEANUP_LOGS_FAILED" }
    );
    throw error;
  }
}
