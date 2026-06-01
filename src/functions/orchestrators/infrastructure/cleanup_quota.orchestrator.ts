/**
 * Cleanup Quota Orchestrator
 *
 * Coordinates the cleanup of old quota tracking and snapshot data.
 * Handles batched deletion with proper tracing and error handling.
 *
 * @module orchestrator/infrastructure/cleanup_quota
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
  delete_old_quota_tracking,
  delete_old_quota_snapshots,
} from "../../repositories/infrastructure";
import { get_infrastructure_config } from "../../infrastructure/config";

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
export async function cleanup_quota(
  ctx: TraceContext,
  config?: CleanupQuotaConfig
): Promise<CleanupQuotaResult> {
  const span = create_span(ctx, "orchestrator", "cleanup_quota");
  log_operation_start(span);

  // Get configuration from centralized config
  const infra_config = await get_infrastructure_config();

  const retention_days = config?.retention_days ?? infra_config.quota_retention_days;
  const batch_size = config?.batch_size ?? infra_config.cleanup_batch_size;
  const max_batches = config?.max_batches ?? infra_config.cleanup_max_batches;

  // Calculate cutoffs
  const cutoff_date = new Date();
  cutoff_date.setDate(cutoff_date.getDate() - retention_days);
  const cutoff_string = cutoff_date.toISOString().split("T")[0];
  const cutoff_timestamp = Timestamp.fromDate(cutoff_date);

  try {
    // Clean up tracking data
    let tracking_deleted = 0;
    let batches_processed = 0;
    let batch_deleted = 0;

    do {
      const batch_ctx = create_child_span(ctx);
      const result = await delete_old_quota_tracking(
        batch_ctx,
        cutoff_string,
        batch_size
      );

      batch_deleted = result.deleted_count;
      tracking_deleted += batch_deleted;
      batches_processed++;
    } while (batch_deleted === batch_size && batches_processed < max_batches);

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_quota",
      status: "tracking_complete",
      context: { tracking_deleted, batches_processed },
    }));

    // Clean up snapshots
    let snapshots_deleted = 0;
    batches_processed = 0;
    batch_deleted = 0;

    do {
      const batch_ctx = create_child_span(ctx);
      const result = await delete_old_quota_snapshots(
        batch_ctx,
        cutoff_timestamp,
        batch_size
      );

      batch_deleted = result.deleted_count;
      snapshots_deleted += batch_deleted;
      batches_processed++;
    } while (batch_deleted === batch_size && batches_processed < max_batches);

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "cleanup_quota",
      status: "snapshots_complete",
      context: { snapshots_deleted, batches_processed },
    }));

    const total_deleted = tracking_deleted + snapshots_deleted;

    log_operation_success(span);

    return {
      tracking_deleted,
      snapshots_deleted,
      total_deleted,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { error_code: "CLEANUP_QUOTA_FAILED" }
    );
    throw error;
  }
}
