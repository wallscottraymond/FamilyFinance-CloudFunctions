/**
 * Cleanup Trigger Processing Orchestrator
 *
 * Coordinates the cleanup of old trigger processing records.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_trigger_processing
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
import { delete_old_trigger_records } from "../../repositories/infrastructure";
import { get_infrastructure_config } from "../../infrastructure/config";

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
export async function cleanup_trigger_processing(
  ctx: TraceContext,
  config?: CleanupTriggerProcessingConfig
): Promise<CleanupTriggerProcessingResult> {
  const span = create_span(ctx, "orchestrator", "cleanup_trigger_processing");
  log_operation_start(span);

  // Get configuration from centralized config
  const infra_config = await get_infrastructure_config();

  const retention_days = config?.retention_days ?? infra_config.trigger_retention_days;
  const batch_size = config?.batch_size ?? infra_config.cleanup_batch_size;
  const max_batches = config?.max_batches ?? infra_config.cleanup_max_batches;

  const cutoff = Timestamp.fromMillis(
    Date.now() - retention_days * 24 * 60 * 60 * 1000
  );

  let total_deleted = 0;
  let batches_processed = 0;
  let batch_deleted = 0;

  try {
    do {
      const batch_ctx = create_child_span(ctx);
      const result = await delete_old_trigger_records(batch_ctx, cutoff, batch_size);

      batch_deleted = result.deleted_count;
      total_deleted += batch_deleted;
      batches_processed++;

      if (batch_deleted > 0) {
        fire_and_forget(() => log_async_debug({
          trace_id: ctx.trace_id,
          span_id: span.span_id,
          layer: "orchestrator",
          function: "cleanup_trigger_processing",
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

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_trigger_processing",
      status: "success",
      output: {
        total_deleted,
        batches_processed,
        completed,
        retention_days,
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
      { error_code: "CLEANUP_TRIGGER_PROCESSING_FAILED" }
    );
    throw error;
  }
}
