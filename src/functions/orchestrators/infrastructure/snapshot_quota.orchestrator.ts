/**
 * Snapshot Quota Orchestrator
 *
 * Coordinates quota snapshot creation and alert checking.
 * Creates periodic snapshots for health monitoring.
 *
 * @module orchestrator/infrastructure/snapshot_quota
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import {
  get_today_usage,
  save_quota_snapshot,
  get_latest_quota_snapshot,
} from "../../repositories/infrastructure";
import { get_infrastructure_config } from "../../infrastructure/config";
import {
  determine_alert_status,
  calculate_usage_percentages,
  AlertStatus,
  QuotaAlertResult,
} from "../../domain/infrastructure/quota_alerts";

/**
 * Result of snapshot operation.
 */
export interface SnapshotQuotaResult {
  reads_percent: number;
  writes_percent: number;
  reads_count: number;
  writes_count: number;
  alert_status: AlertStatus;
  alert_message?: string;
}

/**
 * Orchestrates quota snapshot creation and alert checking.
 *
 * @param ctx - Trace context
 * @returns Snapshot result with alert status
 */
export async function snapshot_quota(
  ctx: TraceContext
): Promise<SnapshotQuotaResult> {
  const span = create_span(ctx, "orchestrator", "snapshot_quota");
  log_operation_start(span);

  try {
    // Get configuration
    const config = await get_infrastructure_config();

    // Get current usage from repository
    const usage = await get_today_usage(ctx);

    // Use domain function to calculate percentages
    const percentages = calculate_usage_percentages(
      usage.reads,
      usage.writes,
      {
        daily_reads: config.quota.daily_reads_limit,
        daily_writes: config.quota.daily_writes_limit,
      }
    );

    // Save snapshot via repository
    await save_quota_snapshot(ctx, {
      reads_percent: percentages.reads_percent,
      writes_percent: percentages.writes_percent,
      reads_count: usage.reads,
      writes_count: usage.writes,
      limits: {
        daily_reads: config.quota.daily_reads_limit,
        daily_writes: config.quota.daily_writes_limit,
      },
    });

    // Use domain function to determine alert status
    const alert = determine_alert_status(percentages, {
      warning_threshold_percent: config.quota.warning_threshold_percent,
      critical_threshold_percent: config.quota.critical_threshold_percent,
    });

    log_operation_success(span);

    fire_and_forget(() => log_async_debug({
      trace_id: ctx.trace_id,
      span_id: span.span_id,
      layer: "orchestrator",
      function: "snapshot_quota",
      status: "success",
      output: {
        reads_percent: percentages.reads_percent,
        writes_percent: percentages.writes_percent,
        reads_count: usage.reads,
        writes_count: usage.writes,
        alert_status: alert.status,
      },
    }));

    return {
      reads_percent: percentages.reads_percent,
      writes_percent: percentages.writes_percent,
      reads_count: usage.reads,
      writes_count: usage.writes,
      alert_status: alert.status,
      alert_message: alert.message,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { error_code: "SNAPSHOT_QUOTA_FAILED" }
    );
    throw error;
  }
}

/**
 * Gets current quota alert status without creating a snapshot.
 *
 * @param ctx - Trace context
 * @returns Alert status based on latest snapshot
 */
export async function check_quota_alerts(
  ctx: TraceContext
): Promise<QuotaAlertResult & { reads_percent: number; writes_percent: number }> {
  const snapshot = await get_latest_quota_snapshot(ctx);

  if (!snapshot) {
    return {
      status: "ok",
      message: "No quota data available",
      max_usage_percent: 0,
      reads_percent: 0,
      writes_percent: 0,
    };
  }

  const config = await get_infrastructure_config();

  const alert = determine_alert_status(
    { reads_percent: snapshot.reads_percent, writes_percent: snapshot.writes_percent },
    {
      warning_threshold_percent: config.quota.warning_threshold_percent,
      critical_threshold_percent: config.quota.critical_threshold_percent,
    }
  );

  return {
    ...alert,
    reads_percent: snapshot.reads_percent,
    writes_percent: snapshot.writes_percent,
  };
}

// Re-export for convenience
export { AlertStatus } from "../../domain/infrastructure/quota_alerts";
