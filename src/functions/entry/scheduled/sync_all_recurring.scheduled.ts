/**
 * Sync All Recurring Scheduled Function (webhook fallback)
 *
 * Every 6 hours, runs a recurring (bill/income stream) sync for every active
 * Plaid item across all users. Guarantees recurring streams stay fresh even
 * though Plaid's `RECURRING_TRANSACTIONS_UPDATE` webhooks are infrequent/unreliable
 * (they only fire on a detected stream change). Mirrors `sync_all_transactions`.
 *
 * @module entry/scheduled/sync_all_recurring
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { create_trace_context } from "../../observability";
import {
  sync_all_recurring_orchestrator,
} from "../../orchestrators/plaid/sync_all_recurring.orchestrator";

// The sync orchestrator decrypts access tokens and calls the Plaid API.
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

export const sync_all_recurring_scheduled = onSchedule(
  /* eslint-disable @typescript-eslint/naming-convention */
  {
    schedule: "0 */6 * * *",
    timeZone: "UTC",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
  },
  /* eslint-enable @typescript-eslint/naming-convention */
  async () => {
    const ctx = create_trace_context();
    const result = await sync_all_recurring_orchestrator(ctx);
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "Scheduled fallback recurring sync completed",
        trace_id: ctx.trace_id,
        ...result,
      })
    );
  }
);
