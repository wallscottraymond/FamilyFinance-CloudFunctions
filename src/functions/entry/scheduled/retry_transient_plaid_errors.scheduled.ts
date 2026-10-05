/**
 * Retry Transient Plaid Errors Scheduled Function
 *
 * Every 4 hours, silently retries Plaid items stuck in a transient error state
 * (institution down / rate limited). Recovers them automatically when the
 * institution comes back, and only surfaces a "Reconnect" prompt to the user if
 * the failure persists past 24 hours.
 *
 * Also runs the re-auth self-heal pass: items flagged for reconnection are probed
 * and marked healthy if they work again (a repair done in-app sends no webhook,
 * and older app builds don't report it).
 *
 * And retries Plaid itemRemove for items whose removal failed during an account
 * removal (flagged `removalPending`), so Plaid stops billing for them.
 *
 * Schedule: every 4 hours.
 *
 * @module entry/scheduled/retry_transient_plaid_errors
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { create_trace_context } from "../../observability";
import {
  retry_transient_item_errors_orchestrator,
} from "../../orchestrators/plaid/retry_transient_item_errors.orchestrator";
import {
  self_heal_reauth_items_orchestrator,
} from "../../orchestrators/plaid/reauth_recovery.orchestrator";
import {
  retry_pending_item_removals_orchestrator,
} from "../../orchestrators/plaid/retry_pending_item_removals.orchestrator";
import { RETRY_SCHEDULE } from "../../types/plaid/transient_error_retry.types";

// Both passes decrypt access tokens and call Plaid. Without these the probes
// could never succeed, so transient items could only escalate, never recover.
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Scheduled silent retry of Plaid items in a transient error state.
 */
export const retry_transient_plaid_errors_scheduled = onSchedule(
  /* eslint-disable @typescript-eslint/naming-convention */
  {
    schedule: RETRY_SCHEDULE,
    timeZone: "UTC",
    memory: "256MiB",
    timeoutSeconds: 540,
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  /* eslint-enable @typescript-eslint/naming-convention */
  async () => {
    const ctx = create_trace_context();

    const result = await retry_transient_item_errors_orchestrator(ctx);
    const self_heal = await self_heal_reauth_items_orchestrator(ctx);
    const removals = await retry_pending_item_removals_orchestrator(ctx);

    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "Transient Plaid error auto-retry completed",
        trace_id: ctx.trace_id,
        ...result,
        reauth_probed: self_heal.probed,
        reauth_repaired: self_heal.repaired,
        reauth_still_needed: self_heal.still_needs_reauth,
        removals_retried: removals.attempted,
        removals_done: removals.removed,
      })
    );
  }
);
