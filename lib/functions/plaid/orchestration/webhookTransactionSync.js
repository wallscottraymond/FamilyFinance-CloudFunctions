"use strict";
/**
 * Webhook Transaction Sync Orchestration
 *
 * Orchestrates the transaction sync process when triggered by Plaid webhooks.
 * This is a wrapper around the core sync logic that handles webhook-specific concerns.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.processWebhookTransactionSync = processWebhookTransactionSync;
const syncTransactions_1 = require("../api/sync/syncTransactions");
/**
 * Process webhook-triggered transaction sync
 *
 * Delegates to the core sync implementation in syncTransactions.ts
 *
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param itemDoc - Optional: pass item data directly from webhook to avoid extra lookup
 * @returns Sync result with counts
 */
async function processWebhookTransactionSync(itemId, userId, itemDoc) {
    return await (0, syncTransactions_1.processWebhookTransactionSync)(itemId, userId, itemDoc);
}
//# sourceMappingURL=webhookTransactionSync.js.map