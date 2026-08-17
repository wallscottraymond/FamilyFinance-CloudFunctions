/**
 * Sync All Transactions Scheduled Function (webhook fallback)
 *
 * Every 6 hours, runs a transaction sync for every active Plaid item across all
 * users. Guarantees data keeps flowing even if a Plaid webhook is missed or
 * rejected — the failure mode that previously froze transactions silently.
 *
 * @module entry/scheduled/sync_all_transactions
 */
export declare const sync_all_transactions_scheduled: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=sync_all_transactions.scheduled.d.ts.map