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
export declare const sync_all_recurring_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=sync_all_recurring.scheduled.d.ts.map