"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.retry_transient_plaid_errors_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const retry_transient_item_errors_orchestrator_1 = require("../../orchestrators/plaid/retry_transient_item_errors.orchestrator");
const transient_error_retry_types_1 = require("../../types/plaid/transient_error_retry.types");
/**
 * Scheduled silent retry of Plaid items in a transient error state.
 */
exports.retry_transient_plaid_errors_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: transient_error_retry_types_1.RETRY_SCHEDULE, timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, retry_transient_item_errors_orchestrator_1.retry_transient_item_errors_orchestrator)(ctx);
    console.log(JSON.stringify(Object.assign({ severity: "INFO", message: "Transient Plaid error auto-retry completed", trace_id: ctx.trace_id }, result)));
});
//# sourceMappingURL=retry_transient_plaid_errors.scheduled.js.map