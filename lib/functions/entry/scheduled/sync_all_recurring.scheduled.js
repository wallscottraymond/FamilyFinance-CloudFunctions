"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_all_recurring_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const observability_1 = require("../../observability");
const sync_all_recurring_orchestrator_1 = require("../../orchestrators/plaid/sync_all_recurring.orchestrator");
// The sync orchestrator decrypts access tokens and calls the Plaid API.
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
exports.sync_all_recurring_scheduled = (0, scheduler_1.onSchedule)(
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
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, sync_all_recurring_orchestrator_1.sync_all_recurring_orchestrator)(ctx);
    console.log(JSON.stringify(Object.assign({ severity: "INFO", message: "Scheduled fallback recurring sync completed", trace_id: ctx.trace_id }, result)));
});
//# sourceMappingURL=sync_all_recurring.scheduled.js.map