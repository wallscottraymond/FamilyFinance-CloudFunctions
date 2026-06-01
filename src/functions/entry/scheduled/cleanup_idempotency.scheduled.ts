/**
 * Idempotency Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of expired idempotency records.
 * Records expire after 24 hours.
 *
 * Schedule: Daily at 3:00 AM UTC
 *
 * @module entry/scheduled/cleanup_idempotency
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import { cleanup_idempotency } from "../../orchestrators/infrastructure";

/**
 * Scheduled cleanup of expired idempotency records.
 */
export const cleanup_idempotency_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "0 3 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await cleanup_idempotency(ctx);

    console.log(JSON.stringify({
      severity: "INFO",
      message: "Idempotency cleanup completed",
      trace_id: ctx.trace_id,
      ...result,
    }));
  }
);
