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

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as crypto from "crypto";
import { generate_id } from "../../observability";
import { webhook_balance_sync_orchestrator, sync_transactions_orchestrator } from "../../orchestrators/plaid";
import { resolve_webhook_transaction_sync_dependencies } from "../../resolvers/plaid";
import { PlaidWebhookType, PlaidWebhookCode } from "../../../types";

// Secrets required for webhook verification
const plaidClientId = defineSecret("PLAID_CLIENT_ID");
const plaidSecret = defineSecret("PLAID_SECRET");
const plaidWebhookSecret = defineSecret("PLAID_WEBHOOK_SECRET");
const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Verifies Plaid webhook signature using HMAC-SHA256.
 * Returns true if signature is valid.
 */
function verify_webhook_signature(
  body: string,
  signature: string,
  secret: string
): boolean {
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
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected_signature, "hex")
    );
  } catch (error) {
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
export const plaid_webhook = onRequest(
  {
    memory: "512MiB",
    timeoutSeconds: 30, // Webhooks need fast response
    cors: false, // Webhooks should not have CORS
    secrets: [plaidClientId, plaidSecret, plaidWebhookSecret, tokenEncryptionKey],
  },
  async (req, res) => {
    // 1. METHOD CHECK
    if (req.method !== "POST") {
      res.status(405).json({ error: "Only POST requests allowed" });
      return;
    }

    // 2. CREATE TRACE CONTEXT
    const trace_id = generate_id();
    const span_id = generate_id();

    // 3. EXTRACT WEBHOOK DATA
    const webhook_body = JSON.stringify(req.body);
    const signature = req.get("plaid-verification") || "";
    const {
      webhook_type,
      webhook_code,
      item_id: plaid_item_id,
      request_id,
    } = req.body;

    console.log(
      `[${trace_id}] Plaid webhook received: type=${webhook_type}, ` +
      `code=${webhook_code}, item=${plaid_item_id}`
    );

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
    } else {
      console.log(`[${trace_id}] Webhook signature verification skipped (development)`);
    }

    // 5. ROUTE TO APPROPRIATE ORCHESTRATOR
    try {
      const result = await route_webhook(
        trace_id,
        span_id,
        webhook_type,
        webhook_code,
        plaid_item_id,
        request_id
      );

      // 6. RETURN SUCCESS
      res.status(200).json({
        success: true,
        processed: result.processed,
        message: result.message,
        trace_id,
      });

    } catch (error) {
      console.error(`[${trace_id}] Webhook processing error:`, error);

      // Still return 200 to prevent Plaid from retrying for system errors
      res.status(200).json({
        success: false,
        error: "Internal processing error",
        trace_id,
      });
    }
  }
);

/**
 * Routes webhook to appropriate orchestrator based on type and code.
 */
async function route_webhook(
  trace_id: string,
  span_id: string,
  webhook_type: string,
  webhook_code: string,
  plaid_item_id: string,
  request_id?: string
): Promise<{ processed: boolean; message: string }> {

  // ITEM webhooks
  if (webhook_type === PlaidWebhookType.ITEM) {
    switch (webhook_code) {
      case PlaidWebhookCode.NEW_ACCOUNTS_AVAILABLE: {
        // New accounts added - sync balances to create/update accounts
        const result = await webhook_balance_sync_orchestrator({
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

      case PlaidWebhookCode.ERROR:
      case PlaidWebhookCode.PENDING_EXPIRATION:
      case PlaidWebhookCode.USER_PERMISSION_REVOKED:
        // These are informational - log but no orchestrator needed
        console.log(
          `[${trace_id}] Item status webhook: ${webhook_code} for item ${plaid_item_id}`
        );
        return { processed: true, message: `Item status: ${webhook_code}` };

      default:
        console.log(
          `[${trace_id}] Unhandled ITEM webhook code: ${webhook_code}`
        );
        return { processed: false, message: `Unhandled: ${webhook_code}` };
    }
  }

  // TRANSACTIONS webhooks
  if (webhook_type === PlaidWebhookType.TRANSACTIONS) {
    switch (webhook_code) {
      case PlaidWebhookCode.SYNC_UPDATES_AVAILABLE:
      case PlaidWebhookCode.DEFAULT_UPDATE:
      case PlaidWebhookCode.INITIAL_UPDATE: {
        // Resolve dependencies (look up item by Plaid ID)
        const deps = await resolve_webhook_transaction_sync_dependencies(
          { trace_id, span_id },
          plaid_item_id
        );

        if (!deps) {
          console.warn(
            `[${trace_id}] Could not resolve dependencies for item ${plaid_item_id}`
          );
          return { processed: false, message: "Item not found" };
        }

        // Call the transaction sync orchestrator
        const result = await sync_transactions_orchestrator({
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
          console.error(
            `[${trace_id}] Transaction sync failed: ${result.error}`
          );
          return { processed: false, message: result.error || "Sync failed" };
        }

        return {
          processed: true,
          message: `Synced: +${result.added_count} -${result.removed_count} ~${result.modified_count}`,
        };
      }

      default:
        console.log(
          `[${trace_id}] Unhandled TRANSACTIONS webhook code: ${webhook_code}`
        );
        return { processed: false, message: `Unhandled: ${webhook_code}` };
    }
  }

  // RECURRING_TRANSACTIONS webhooks - placeholder for future migration
  if (webhook_type === PlaidWebhookType.RECURRING_TRANSACTIONS) {
    console.log(
      `[${trace_id}] RECURRING_TRANSACTIONS webhook - delegating to legacy handler`
    );
    return { processed: false, message: "Delegated to legacy handler" };
  }

  // Unknown webhook type
  console.log(`[${trace_id}] Unhandled webhook type: ${webhook_type}`);
  return { processed: false, message: `Unhandled type: ${webhook_type}` };
}
