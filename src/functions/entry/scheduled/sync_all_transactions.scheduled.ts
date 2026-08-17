/**
 * Sync All Transactions Scheduled Function (webhook fallback)
 *
 * Every 6 hours, runs a transaction sync for every active Plaid item across all
 * users. Guarantees data keeps flowing even if a Plaid webhook is missed or
 * rejected — the failure mode that previously froze transactions silently.
 *
 * @module entry/scheduled/sync_all_transactions
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { create_trace_context } from "../../observability";
import {
  sync_all_transactions_orchestrator,
} from "../../orchestrators/plaid/sync_all_transactions.orchestrator";

// The sync orchestrator decrypts access tokens and calls the Plaid API.
const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = defineSecret("TOKEN_ENCRYPTION_KEY");

export const sync_all_transactions_scheduled = onSchedule(
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
    const result = await sync_all_transactions_orchestrator(ctx);
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "Scheduled fallback transaction sync completed",
        trace_id: ctx.trace_id,
        ...result,
      })
    );
  }
);
