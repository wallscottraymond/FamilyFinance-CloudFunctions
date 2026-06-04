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
/**
 * Scheduled silent retry of Plaid items in a transient error state.
 */
export declare const retry_transient_plaid_errors_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=retry_transient_plaid_errors.scheduled.d.ts.map