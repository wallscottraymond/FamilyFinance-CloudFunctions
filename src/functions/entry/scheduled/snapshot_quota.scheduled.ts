/**
 * Quota Snapshot Scheduled Functions
 *
 * Entry points for quota monitoring:
 * - snapshot_quota_scheduled: Creates hourly quota snapshots
 * - cleanup_quota_scheduled: Cleans up old quota data daily
 *
 * @module entry/scheduled/snapshot_quota
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import {
  snapshot_quota,
  cleanup_quota,
} from "../../orchestrators/infrastructure";
import { get_infrastructure_config } from "../../infrastructure/config";

/**
 * Scheduled quota snapshot creation.
 * Runs every hour at :15 minutes.
 *
 * Creates a snapshot of current quota usage and checks for alerts.
 */
export const snapshot_quota_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "15 * * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 60 },
  async () => {
    const ctx = create_trace_context();

    const result = await snapshot_quota(ctx);

    // Get config for threshold values in logs
    const config = await get_infrastructure_config();

    // Log based on alert status
    if (result.alert_status === "critical") {
      console.log(JSON.stringify({
        severity: "ERROR",
        message: result.alert_message,
        trace_id: ctx.trace_id,
        alert_status: result.alert_status,
        reads_percent: result.reads_percent,
        writes_percent: result.writes_percent,
        threshold: config.quota.critical_threshold_percent,
      }));
    } else if (result.alert_status === "warning") {
      console.log(JSON.stringify({
        severity: "WARNING",
        message: result.alert_message,
        trace_id: ctx.trace_id,
        alert_status: result.alert_status,
        reads_percent: result.reads_percent,
        writes_percent: result.writes_percent,
        threshold: config.quota.warning_threshold_percent,
      }));
    }

    console.log(JSON.stringify({
      severity: "INFO",
      message: "Quota snapshot created",
      trace_id: ctx.trace_id,
      reads_percent: result.reads_percent,
      writes_percent: result.writes_percent,
      reads_count: result.reads_count,
      writes_count: result.writes_count,
    }));
  }
);

/**
 * Scheduled cleanup of old quota data.
 * Runs daily at 4:30 AM UTC.
 *
 * Cleans up quota tracking and snapshot data older than 30 days.
 */
export const cleanup_quota_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "30 4 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 120 },
  async () => {
    const ctx = create_trace_context();

    const result = await cleanup_quota(ctx);

    console.log(JSON.stringify({
      severity: "INFO",
      message: "Quota data cleanup completed",
      trace_id: ctx.trace_id,
      ...result,
    }));
  }
);
