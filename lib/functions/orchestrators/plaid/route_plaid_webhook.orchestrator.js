"use strict";
/**
 * Route Plaid Webhook Orchestrator
 *
 * The single orchestrator the `plaid_webhook` HTTP entry calls. Routes a
 * verified webhook to the right handler by type/code: balance sync, item
 * error/expiration/permission, login repaired, or transaction sync. Resolves
 * dependencies (for the transaction-sync case) and fans out to the relevant
 * sub-orchestrators. The entry keeps only protocol concerns (method check,
 * signature verification, trace creation, response mapping).
 *
 * @module orchestrators/plaid/route_plaid_webhook
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.route_plaid_webhook_orchestrator = route_plaid_webhook_orchestrator;
const webhook_balance_sync_orchestrator_1 = require("./webhook_balance_sync.orchestrator");
const sync_transactions_orchestrator_1 = require("./sync_transactions.orchestrator");
const sync_recurring_orchestrator_1 = require("./sync_recurring.orchestrator");
const handle_item_error_orchestrator_1 = require("./handle_item_error.orchestrator");
const handle_login_repaired_orchestrator_1 = require("./handle_login_repaired.orchestrator");
const plaid_1 = require("../../resolvers/plaid");
const types_1 = require("../../../types");
async function route_plaid_webhook_orchestrator(ctx, input) {
    const { trace_id, span_id } = ctx;
    const { webhook_type, webhook_code, plaid_item_id, request_id, webhook_body } = input;
    // ITEM webhooks
    if (webhook_type === types_1.PlaidWebhookType.ITEM) {
        switch (webhook_code) {
            case types_1.PlaidWebhookCode.NEW_ACCOUNTS_AVAILABLE: {
                // New accounts added - sync balances to create/update accounts
                const result = await (0, webhook_balance_sync_orchestrator_1.webhook_balance_sync_orchestrator)({
                    trace_id,
                    span_id,
                    input: { plaid_item_id, webhook_type, webhook_code, request_id },
                    user_id: "webhook", // User ID determined by orchestrator
                    idempotency_key: `webhook:balance_sync:${request_id || plaid_item_id}:${Date.now()}`,
                });
                if (result.skipped) {
                    return { processed: false, message: result.skip_reason || "Skipped" };
                }
                if (!result.success) {
                    return { processed: false, message: result.error || "Failed" };
                }
                return {
                    processed: true,
                    message: `Synced: ${result.accounts_created} created, ${result.accounts_updated} updated`,
                };
            }
            case types_1.PlaidWebhookCode.ERROR:
            case types_1.PlaidWebhookCode.PENDING_EXPIRATION:
            case types_1.PlaidWebhookCode.USER_PERMISSION_REVOKED: {
                // Process item error/expiration webhooks
                const error_result = await (0, handle_item_error_orchestrator_1.handle_item_error_orchestrator)({
                    trace_id,
                    span_id,
                    input: {
                        plaid_item_id,
                        webhook_type,
                        webhook_code,
                        request_id,
                        consent_expiration_time: webhook_body.consent_expiration_time,
                        error: webhook_body.error,
                    },
                    user_id: "webhook",
                    idempotency_key: `webhook:item_error:${request_id || plaid_item_id}:${Date.now()}`,
                });
                if (error_result.skipped) {
                    return { processed: false, message: error_result.skip_reason || "Skipped" };
                }
                return {
                    processed: true,
                    message: `Item status updated: ${error_result.previous_status} -> ${error_result.new_status}`,
                };
            }
            case types_1.PlaidWebhookCode.LOGIN_REPAIRED: {
                // Process login repaired webhook - clear error state and refresh data
                const repaired_result = await (0, handle_login_repaired_orchestrator_1.handle_login_repaired_orchestrator)({
                    trace_id,
                    span_id,
                    input: { plaid_item_id, webhook_type, webhook_code, request_id },
                    user_id: "webhook",
                    idempotency_key: `webhook:login_repaired:${request_id || plaid_item_id}:${Date.now()}`,
                });
                if (repaired_result.skipped) {
                    return { processed: false, message: repaired_result.skip_reason || "Skipped" };
                }
                return {
                    processed: true,
                    message: `Login repaired: ${repaired_result.previous_status} -> ${repaired_result.new_status}` +
                        (repaired_result.refresh_triggered ? " (refresh triggered)" : ""),
                };
            }
            default:
                console.log(`[${trace_id}] Unhandled ITEM webhook code: ${webhook_code}`);
                return { processed: false, message: `Unhandled: ${webhook_code}` };
        }
    }
    // TRANSACTIONS webhooks
    if (webhook_type === types_1.PlaidWebhookType.TRANSACTIONS) {
        switch (webhook_code) {
            case types_1.PlaidWebhookCode.SYNC_UPDATES_AVAILABLE:
            case types_1.PlaidWebhookCode.DEFAULT_UPDATE:
            case types_1.PlaidWebhookCode.INITIAL_UPDATE: {
                // Resolve dependencies (look up item by Plaid ID)
                const deps = await (0, plaid_1.resolve_webhook_transaction_sync_dependencies)({ trace_id, span_id }, plaid_item_id);
                if (!deps) {
                    console.warn(`[${trace_id}] Could not resolve dependencies for item ${plaid_item_id}`);
                    return { processed: false, message: "Item not found" };
                }
                const result = await (0, sync_transactions_orchestrator_1.sync_transactions_orchestrator)({
                    trace_id,
                    span_id,
                    input: {
                        item_id: deps.plaid_item.doc_id, // Use document ID
                        user_id: deps.plaid_item.user_id,
                    },
                    user_id: deps.plaid_item.user_id,
                    idempotency_key: `webhook:transaction_sync:${request_id || plaid_item_id}:${Date.now()}`,
                });
                if (!result.success) {
                    console.error(`[${trace_id}] Transaction sync failed: ${result.error}`);
                    return { processed: false, message: result.error || "Sync failed" };
                }
                return {
                    processed: true,
                    message: `Synced: +${result.added_count} -${result.removed_count} ~${result.modified_count}`,
                };
            }
            default:
                console.log(`[${trace_id}] Unhandled TRANSACTIONS webhook code: ${webhook_code}`);
                return { processed: false, message: `Unhandled: ${webhook_code}` };
        }
    }
    // RECURRING_TRANSACTIONS webhooks → v2 recurring sync (bill/income streams).
    if (webhook_type === types_1.PlaidWebhookType.RECURRING_TRANSACTIONS) {
        const deps = await (0, plaid_1.resolve_webhook_transaction_sync_dependencies)({ trace_id, span_id }, plaid_item_id);
        if (!deps) {
            console.warn(`[${trace_id}] RECURRING_TRANSACTIONS: item ${plaid_item_id} not found`);
            return { processed: false, message: "Item not found" };
        }
        const result = await (0, sync_recurring_orchestrator_1.sync_recurring_orchestrator)({
            trace_id,
            span_id,
            input: { item_id: deps.plaid_item.doc_id },
            user_id: deps.plaid_item.user_id,
            idempotency_key: `webhook:recurring_sync:${request_id || plaid_item_id}:${Date.now()}`,
        });
        return {
            processed: result.success !== false,
            message: result.success === false
                ? (result.error || "Recurring sync failed")
                : "Recurring sync complete",
        };
    }
    console.log(`[${trace_id}] Unhandled webhook type: ${webhook_type}`);
    return { processed: false, message: `Unhandled type: ${webhook_type}` };
}
//# sourceMappingURL=route_plaid_webhook.orchestrator.js.map