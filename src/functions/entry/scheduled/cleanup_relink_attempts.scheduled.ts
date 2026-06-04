/**
 * Relink Attempts Cleanup Scheduled Function
 *
 * Daily retention cleanup of old Plaid relink-attempt records (30-day window).
 *
 * Schedule: Daily at 3:30 AM UTC.
 *
 * @module entry/scheduled/cleanup_relink_attempts
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import {
  cleanup_relink_attempts,
} from "../../orchestrators/infrastructure/cleanup_relink_attempts.orchestrator";

/**
 * Scheduled cleanup of old relink-attempt records.
 */
export const cleanup_relink_attempts_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "30 3 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await cleanup_relink_attempts(ctx);

    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "Relink attempts cleanup completed",
        trace_id: ctx.trace_id,
        ...result,
      })
    );
  }
);
