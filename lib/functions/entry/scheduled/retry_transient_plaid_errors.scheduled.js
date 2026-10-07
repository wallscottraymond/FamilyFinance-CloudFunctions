"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry_transient_plaid_errors_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const params_1 = require("firebase-functions/params");
const observability_1 = require("../../observability");
const retry_transient_item_errors_orchestrator_1 = require("../../orchestrators/plaid/retry_transient_item_errors.orchestrator");
const reauth_recovery_orchestrator_1 = require("../../orchestrators/plaid/reauth_recovery.orchestrator");
const retry_pending_item_removals_orchestrator_1 = require("../../orchestrators/plaid/retry_pending_item_removals.orchestrator");
const transient_error_retry_types_1 = require("../../types/plaid/transient_error_retry.types");
// Both passes decrypt access tokens and call Plaid. Without these the probes
// could never succeed, so transient items could only escalate, never recover.
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Scheduled silent retry of Plaid items in a transient error state.
 */
exports.retry_transient_plaid_errors_scheduled = (0, scheduler_1.onSchedule)(
/* eslint-disable @typescript-eslint/naming-convention */
{
    schedule: transient_error_retry_types_1.RETRY_SCHEDULE,
    timeZone: "UTC",
    memory: "256MiB",
    timeoutSeconds: 540,
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
}, 
/* eslint-enable @typescript-eslint/naming-convention */
async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, retry_transient_item_errors_orchestrator_1.retry_transient_item_errors_orchestrator)(ctx);
    const self_heal = await (0, reauth_recovery_orchestrator_1.self_heal_reauth_items_orchestrator)(ctx);
    const removals = await (0, retry_pending_item_removals_orchestrator_1.retry_pending_item_removals_orchestrator)(ctx);
    console.log(JSON.stringify(Object.assign(Object.assign({ severity: "INFO", message: "Transient Plaid error auto-retry completed", trace_id: ctx.trace_id }, result), { reauth_probed: self_heal.probed, reauth_repaired: self_heal.repaired, reauth_still_needed: self_heal.still_needs_reauth, removals_retried: removals.attempted, removals_done: removals.removed })));
});
//# sourceMappingURL=retry_transient_plaid_errors.scheduled.js.map