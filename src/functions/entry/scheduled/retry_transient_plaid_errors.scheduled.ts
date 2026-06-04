/**
 * Retry Transient Plaid Errors Scheduled Function
 *
 * Every 4 hours, silently retries Plaid items stuck in a transient error state
 * (institution down / rate limited). Recovers them automatically when the
 * institution comes back, and only surfaces a "Reconnect" prompt to the user if
 * the failure persists past 24 hours.
 *
 * Schedule: every 4 hours.
 *
 * @module entry/scheduled/retry_transient_plaid_errors
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import {
  retry_transient_item_errors_orchestrator,
} from "../../orchestrators/plaid/retry_transient_item_errors.orchestrator";
import { RETRY_SCHEDULE } from "../../types/plaid/transient_error_retry.types";

/**
 * Scheduled silent retry of Plaid items in a transient error state.
 */
export const retry_transient_plaid_errors_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: RETRY_SCHEDULE, timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await retry_transient_item_errors_orchestrator(ctx);

    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "Transient Plaid error auto-retry completed",
        trace_id: ctx.trace_id,
        ...result,
      })
    );
  }
);
