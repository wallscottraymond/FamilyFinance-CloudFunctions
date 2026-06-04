"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaid_webhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const crypto = __importStar(require("crypto"));
const observability_1 = require("../../observability");
const plaid_1 = require("../../orchestrators/plaid");
const plaid_2 = require("../../resolvers/plaid");
const types_1 = require("../../../types");
// Secrets required for webhook verification
const plaidClientId = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const plaidSecret = (0, params_1.defineSecret)("PLAID_SECRET");
const plaidWebhookSecret = (0, params_1.defineSecret)("PLAID_WEBHOOK_SECRET");
const tokenEncryptionKey = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Verifies Plaid webhook signature using HMAC-SHA256.
 * Returns true if signature is valid.
 */
function verify_webhook_signature(body, signature, secret) {
    try {
        if (!secret) {
            console.error("PLAID_WEBHOOK_SECRET not configured");
            return false;
        }
        if (!signature || typeof signature !== "string") {
            console.warn("Invalid signature format provided");
            return false;
        }
        const expected_signature = crypto
            .createHmac("sha256", secret)
            .update(body)
            .digest("hex");
        // Length check before timing-safe comparison
        if (signature.length !== expected_signature.length) {
            return false;
        }
        // Timing-safe comparison
        return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected_signature, "hex"));
    }
    catch (error) {
        console.error("Error verifying webhook signature:", error);
        return false;
    }
}
/**
 * Plaid Webhook Handler
 *
 * Receives webhooks from Plaid and routes to appropriate orchestrators.
 * Follows architecture: Entry -> Orchestrator -> Resolver -> Domain -> Repository
 */
exports.plaid_webhook = (0, https_1.onRequest)({
    memory: "512MiB",
    timeoutSeconds: 30, // Webhooks need fast response
    cors: false, // Webhooks should not have CORS
    secrets: [plaidClientId, plaidSecret, plaidWebhookSecret, tokenEncryptionKey],
}, async (req, res) => {
    // 1. METHOD CHECK
    if (req.method !== "POST") {
        res.status(405).json({ error: "Only POST requests allowed" });
        return;
    }
    // 2. CREATE TRACE CONTEXT
    const trace_id = (0, observability_1.generate_id)();
    const span_id = (0, observability_1.generate_id)();
    // 3. EXTRACT WEBHOOK DATA
    const webhook_body = JSON.stringify(req.body);
    const signature = req.get("plaid-verification") || "";
    const { webhook_type, webhook_code, item_id: plaid_item_id, request_id, } = req.body;
    console.log(`[${trace_id}] Plaid webhook received: type=${webhook_type}, ` +
        `code=${webhook_code}, item=${plaid_item_id}`);
    // 4. VERIFY WEBHOOK SIGNATURE
    const should_verify = process.env.NODE_ENV === "production" ||
        process.env.VERIFY_WEBHOOK_SIGNATURE === "true";
    if (should_verify) {
        const webhook_secret = plaidWebhookSecret.value();
        if (!verify_webhook_signature(webhook_body, signature, webhook_secret)) {
            console.warn(`[${trace_id}] Invalid webhook signature`);
            res.status(401).json({
                success: false,
                error: "Invalid webhook signature",
            });
            return;
        }
        console.log(`[${trace_id}] Webhook signature verified`);
    }
    else {
        console.log(`[${trace_id}] Webhook signature verification skipped (development)`);
    }
    // 5. ROUTE TO APPROPRIATE ORCHESTRATOR
    try {
        const result = await route_webhook(trace_id, span_id, webhook_type, webhook_code, plaid_item_id, request_id, req.body);
        // 6. RETURN SUCCESS
        res.status(200).json({
            success: true,
            processed: result.processed,
            message: result.message,
            trace_id,
        });
    }
    catch (error) {
        console.error(`[${trace_id}] Webhook processing error:`, error);
        // Still return 200 to prevent Plaid from retrying for system errors
        res.status(200).json({
            success: false,
            error: "Internal processing error",
            trace_id,
        });
    }
});
/**
 * Routes webhook to appropriate orchestrator based on type and code.
 */
async function route_webhook(trace_id, span_id, webhook_type, webhook_code, plaid_item_id, request_id, webhook_body) {
    // ITEM webhooks
    if (webhook_type === types_1.PlaidWebhookType.ITEM) {
        switch (webhook_code) {
            case types_1.PlaidWebhookCode.NEW_ACCOUNTS_AVAILABLE: {
                // New accounts added - sync balances to create/update accounts
                const result = await (0, plaid_1.webhook_balance_sync_orchestrator)({
                    trace_id,
                    span_id,
                    input: {
                        plaid_item_id,
                        webhook_type,
                        webhook_code,
                        request_id,
                    },
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
                const error_result = await (0, plaid_1.handle_item_error_orchestrator)({
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
                const repaired_result = await (0, plaid_1.handle_login_repaired_orchestrator)({
                    trace_id,
                    span_id,
                    input: {
                        plaid_item_id,
                        webhook_type,
                        webhook_code,
                        request_id,
                    },
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
                const deps = await (0, plaid_2.resolve_webhook_transaction_sync_dependencies)({ trace_id, span_id }, plaid_item_id);
                if (!deps) {
                    console.warn(`[${trace_id}] Could not resolve dependencies for item ${plaid_item_id}`);
                    return { processed: false, message: "Item not found" };
                }
                // Call the transaction sync orchestrator
                const result = await (0, plaid_1.sync_transactions_orchestrator)({
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
    // RECURRING_TRANSACTIONS webhooks - placeholder for future migration
    if (webhook_type === types_1.PlaidWebhookType.RECURRING_TRANSACTIONS) {
        console.log(`[${trace_id}] RECURRING_TRANSACTIONS webhook - delegating to legacy handler`);
        return { processed: false, message: "Delegated to legacy handler" };
    }
    // Unknown webhook type
    console.log(`[${trace_id}] Unhandled webhook type: ${webhook_type}`);
    return { processed: false, message: `Unhandled type: ${webhook_type}` };
}
//# sourceMappingURL=plaid_webhook.entry.js.map