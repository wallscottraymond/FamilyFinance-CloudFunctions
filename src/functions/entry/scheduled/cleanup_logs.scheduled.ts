/**
 * Log Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of old log entries.
 * - Tier 1 (minimal logs): 30 days retention
 * - Tier 2 (debug logs): 7 days retention
 * - Traces: 30 days retention
 *
 * Schedule: Daily at 4:00 AM UTC
 *
 * @module entry/scheduled/cleanup_logs
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import { cleanup_logs } from "../../orchestrators/infrastructure";

/**
 * Scheduled cleanup of old log entries.
 */
export const cleanup_logs_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "0 4 * * *", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await cleanup_logs(ctx);

    console.log(JSON.stringify({
      severity: "INFO",
      message: "Log cleanup completed",
      trace_id: ctx.trace_id,
      minimal_deleted: result.minimal.deleted_count,
      debug_deleted: result.debug.deleted_count,
      traces_deleted: result.traces.deleted_count,
      total_deleted: result.total_deleted,
    }));
  }
);
