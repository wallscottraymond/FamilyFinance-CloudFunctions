/**
 * Trigger Processing Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of old trigger processing records.
 * These records track which triggers have been processed to ensure idempotency.
 *
 * Records expire after 7 days.
 *
 * Schedule: Daily at 3:30 AM UTC
 *
 * @module entry/scheduled/cleanup_trigger_processing
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import { cleanup_trigger_processing } from "../../orchestrators/infrastructure";

/**
 * Scheduled cleanup of old trigger processing records.
 */
export const cleanup_trigger_processing_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "30 3 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await cleanup_trigger_processing(ctx);

    console.log(JSON.stringify({
      severity: "INFO",
      message: "Trigger processing cleanup completed",
      trace_id: ctx.trace_id,
      ...result,
    }));
  }
);
