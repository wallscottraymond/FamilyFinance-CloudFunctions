/**
 * Cleanup Idempotency Orchestrator
 *
 * Coordinates the cleanup of expired idempotency records.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_idempotency
 */

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
import { delete_expired_idempotency_records } from "../../repositories/infrastructure";

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
export async function cleanup_idempotency(
  ctx: TraceContext,
  config?: CleanupIdempotencyConfig
): Promise<CleanupIdempotencyResult> {
  const span = create_span(ctx, "orchestrator", "cleanup_idempotency");
  log_operation_start(span);

  const batch_size = config?.batch_size ?? 500;
  const max_batches = config?.max_batches ?? 20;

  let total_deleted = 0;
  let batches_processed = 0;
  let batch_deleted = 0;

  try {
    do {
      const batch_ctx = create_child_span(ctx);
      const result = await delete_expired_idempotency_records(batch_ctx, batch_size);

      batch_deleted = result.deleted_count;
      total_deleted += batch_deleted;
      batches_processed++;

      // Log progress for each batch
      if (batch_deleted > 0) {
        fire_and_forget(() => log_async_debug({
          trace_id: ctx.trace_id,
          span_id: span.span_id,
          layer: "orchestrator",
          function: "cleanup_idempotency",
          status: "batch_complete",
          context: {
            batch_number: batches_processed,
            batch_deleted,
            total_deleted,
          },
        }));
      }
    } while (batch_deleted === batch_size && batches_processed < max_batches);

    const completed = batch_deleted < batch_size;

    log_operation_success(span);

    // Log final summary
    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_idempotency",
      status: "success",
      output: {
        total_deleted,
        batches_processed,
        completed,
      },
    }));

    return {
      total_deleted,
      batches_processed,
      completed,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { error_code: "CLEANUP_IDEMPOTENCY_FAILED" }
    );
    throw error;
  }
}
