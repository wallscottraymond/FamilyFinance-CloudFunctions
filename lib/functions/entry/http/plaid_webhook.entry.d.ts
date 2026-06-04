/**
 * Plaid Webhook Entry Point
 *
 * HTTP endpoint for receiving Plaid webhook notifications.
 * Routes to appropriate orchestrators based on webhook type/code.
 *
 * Currently handles:
 * - ITEM.NEW_ACCOUNTS_AVAILABLE -> webhook_balance_sync_orchestrator
 *
 * Future handlers can be added for:
 * - TRANSACTIONS.SYNC_UPDATES_AVAILABLE -> transaction sync
 * - RECURRING_TRANSACTIONS.RECURRING_TRANSACTIONS_UPDATE -> recurring sync
 *
 * @module entry/http/plaid_webhook
 */
/**
 * Plaid Webhook Handler
 *
 * Receives webhooks from Plaid and routes to appropriate orchestrators.
 * Follows architecture: Entry -> Orchestrator -> Resolver -> Domain -> Repository
 */
export declare const plaid_webhook: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=plaid_webhook.entry.d.ts.map