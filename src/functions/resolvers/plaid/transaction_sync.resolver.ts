/**
 * Transaction Sync Resolver
 *
 * Gathers dependencies for the transaction sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user context (family, currency, groups)
 * - Fetches pending transactions for migration lookup
 *
 * @module resolvers/plaid/transaction_sync
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  ResolveTransactionSyncInput,
  TransactionSyncDependencies,
} from "../../types/plaid";
import { decryptAccessToken } from "../../../utils/encryption";
import { transaction_repo } from "../../repositories";

/**
 * Resolves dependencies needed for the transaction sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item by doc ID
 * 2. Decrypts the access token
 * 3. Gets user context (family, currency, groups)
 * 4. Fetches pending transactions for the item (for migration lookup)
 *
 * @param ctx - Trace context
 * @param input - Transaction sync input
 * @returns Dependencies for the orchestrator
 */
export async function resolve_transaction_sync_dependencies(
  ctx: TraceContext,
  input: ResolveTransactionSyncInput
): Promise<TransactionSyncDependencies | null> {
  const db = getFirestore();

  // Step 1: Fetch plaid_item by document ID
  const item_doc = await db.collection("plaid_items").doc(input.item_id).get();

  if (!item_doc.exists) {
    console.error(
      `[${ctx.trace_id}] Plaid item not found: ${input.item_id}`
    );
    return null;
  }

  const item_data = item_doc.data()!;

  // Verify user ownership
  if (item_data.userId !== input.user_id) {
    console.error(
      `[${ctx.trace_id}] User ${input.user_id} does not own item ${input.item_id}`
    );
    return null;
  }

  // Check if item is active
  if (!item_data.isActive) {
    console.error(
      `[${ctx.trace_id}] Plaid item ${input.item_id} is not active`
    );
    return null;
  }

  // Step 2: Decrypt access token
  const encrypted_token = item_data.accessToken;

  if (!encrypted_token) {
    console.error(
      `[${ctx.trace_id}] Plaid item ${input.item_id} has no access token`
    );
    return null;
  }

  let access_token: string;
  try {
    access_token = decryptAccessToken(encrypted_token);
  } catch (error) {
    console.error(
      `[${ctx.trace_id}] Failed to decrypt access token for item ${input.item_id}:`,
      error
    );
    return null;
  }

  // Step 3: Get user context
  const user_doc = await db.collection("users").doc(input.user_id).get();
  let family_id: string | null = null;
  let currency = "USD";
  let group_ids: string[] = item_data.groupIds || [];

  if (user_doc.exists) {
    const user_data = user_doc.data()!;
    family_id = user_data.familyId || null;

    // Get family settings for currency
    if (family_id) {
      const family_doc = await db.collection("families").doc(family_id).get();
      if (family_doc.exists) {
        const family_data = family_doc.data()!;
        currency = family_data.settings?.currency || "USD";

        // Add family group to group_ids if not already present
        if (!group_ids.includes(family_id)) {
          group_ids = [...group_ids, family_id];
        }
      }
    }
  }

  // Step 4: Get pending transactions for this item
  const pending_transactions = await transaction_repo.get_pending_transactions_for_item(
    ctx,
    input.user_id,
    item_data.plaidItemId
  );

  // Step 5: Get active accounts for this item (filter out hidden accounts)
  const accounts_snapshot = await db.collection("accounts")
    .where("itemId", "==", item_data.plaidItemId)
    .where("isActive", "==", true)
    .get();

  const active_account_ids = new Set<string>(
    accounts_snapshot.docs.map(doc => doc.data().accountId || doc.id)
  );

  console.log(
    `[${ctx.trace_id}] Resolved transaction sync dependencies: ` +
    `item=${input.item_id}, cursor=${item_data.cursor || "none"}, ` +
    `pending=${pending_transactions.size}, active_accounts=${active_account_ids.size}`
  );

  return {
    plaid_item: {
      doc_id: item_doc.id,
      plaid_item_id: item_data.plaidItemId,
      access_token,
      cursor: item_data.cursor || null,
      user_id: input.user_id,
      institution_id: item_data.institutionId || "",
      institution_name: item_data.institutionName || "Unknown Institution",
    },
    user_context: {
      family_id,
      currency,
      group_ids,
    },
    pending_transactions,
    active_account_ids,
  };
}

/**
 * Resolves dependencies for webhook-triggered transaction sync.
 *
 * Similar to above but looks up item by Plaid item ID instead of doc ID.
 *
 * @param ctx - Trace context
 * @param plaid_item_id - Plaid item ID (from webhook)
 * @returns Dependencies for the orchestrator, or null if item not found
 */
export async function resolve_webhook_transaction_sync_dependencies(
  ctx: TraceContext,
  plaid_item_id: string
): Promise<TransactionSyncDependencies | null> {
  const db = getFirestore();

  // Find item by Plaid item ID
  const items_snapshot = await db.collection("plaid_items")
    .where("plaidItemId", "==", plaid_item_id)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (items_snapshot.empty) {
    console.error(
      `[${ctx.trace_id}] No active plaid_item found for Plaid ID: ${plaid_item_id}`
    );
    return null;
  }

  const item_doc = items_snapshot.docs[0];
  const item_data = item_doc.data();
  const user_id = item_data.userId;

  // Use the standard resolver with doc ID
  return resolve_transaction_sync_dependencies(ctx, {
    item_id: item_doc.id,
    user_id,
  });
}
