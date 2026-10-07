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
/**
 * Scheduled silent retry of Plaid items in a transient error state.
 */
export declare const retry_transient_plaid_errors_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=retry_transient_plaid_errors.scheduled.d.ts.map