/**
 * Webhook Balance Sync Resolver
 *
 * Gathers dependencies for webhook-triggered balance sync.
 * - Finds plaid_item by Plaid's item ID
 * - Checks for duplicate webhook processing
 * - Decrypts access token
 *
 * @module resolvers/plaid/webhook_balance_sync
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  WebhookBalanceSyncInput,
  WebhookBalanceSyncDependencies,
} from "../../types/plaid";
import { decryptAccessToken } from "../../../utils/encryption";

/**
 * Resolves dependencies needed for webhook balance sync.
 *
 * This resolver:
 * 1. Checks if webhook was already processed (idempotency)
 * 2. Finds the plaid_item by Plaid's item ID
 * 3. Decrypts the access token
 *
 * @param ctx - Trace context
 * @param input - Webhook balance sync input
 * @returns Dependencies for the orchestrator
 */
export async function resolve_webhook_balance_sync_dependencies(
  ctx: TraceContext,
  input: WebhookBalanceSyncInput
): Promise<WebhookBalanceSyncDependencies> {
  const db = getFirestore();

  // Step 1: Check for duplicate webhook (idempotency)
  if (input.request_id) {
    const existing_webhook = await db.collection("plaid_webhooks")
      .where("requestId", "==", input.request_id)
      .where("processingStatus", "==", "completed")
      .limit(1)
      .get();

    if (!existing_webhook.empty) {
      console.log(
        `[${ctx.trace_id}] Webhook ${input.request_id} already processed, skipping`
      );
      return {
        item: null,
        already_processed: true,
      };
    }
  }

  // Step 2: Find plaid_item by Plaid's item ID
  const items_query = await db.collection("plaid_items")
    .where("plaidItemId", "==", input.plaid_item_id)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (items_query.empty) {
    console.warn(
      `[${ctx.trace_id}] No active plaid_item found for Plaid item ID: ${input.plaid_item_id}`
    );
    return {
      item: null,
      already_processed: false,
    };
  }

  const item_doc = items_query.docs[0];
  const item_data = item_doc.data();

  // Step 3: Decrypt access token
  const encrypted_token = item_data.accessToken;
  if (!encrypted_token) {
    console.error(
      `[${ctx.trace_id}] Plaid item ${item_doc.id} has no access token`
    );
    return {
      item: null,
      already_processed: false,
    };
  }

  let access_token: string;
  try {
    access_token = decryptAccessToken(encrypted_token);
  } catch (error) {
    console.error(
      `[${ctx.trace_id}] Failed to decrypt access token for item ${item_doc.id}:`,
      error
    );
    return {
      item: null,
      already_processed: false,
    };
  }

  console.log(
    `[${ctx.trace_id}] Resolved webhook balance sync dependencies: ` +
    `item=${item_doc.id}, user=${item_data.userId}`
  );

  return {
    item: {
      doc_id: item_doc.id,
      plaid_item_id: input.plaid_item_id,
      user_id: item_data.userId,
      access_token,
      institution_id: item_data.institutionId || "",
      institution_name: item_data.institutionName || "Unknown Institution",
      group_id: item_data.groupIds?.[0],
    },
    already_processed: false,
  };
}

// Recording a processed webhook is a WRITE and now lives in
// `repositories/plaid/plaid_webhook.repo.ts` (`plaid_webhook_repo.record_processed`).
