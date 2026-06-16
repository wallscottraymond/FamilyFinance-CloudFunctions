/**
 * Item Status Webhook Resolver
 *
 * Gathers dependencies for item status webhook processing.
 * Looks up the Plaid item by Plaid's item ID (not our document ID).
 *
 * @module resolvers/plaid/item_status_webhook
 */

import { TraceContext } from "../../types";
import { plaid_item_repo } from "../../repositories/plaid";
import {
  ResolveItemStatusWebhookInput,
  ItemStatusWebhookDependencies,
} from "../../types/plaid/item_status_webhook.types";

/**
 * Resolves dependencies for item status webhook processing.
 *
 * @param ctx - Trace context
 * @param input - Resolution input with Plaid item ID
 * @returns Resolved dependencies
 */
export async function resolve_item_status_webhook_dependencies(
  ctx: TraceContext,
  input: ResolveItemStatusWebhookInput
): Promise<ItemStatusWebhookDependencies> {
  // Look up item by Plaid's item ID (stored as plaidItemId)
  const item = await plaid_item_repo.get_active_raw_by_plaid_item_id(
    ctx,
    input.plaid_item_id
  );

  if (!item) {
    console.log(
      `[${ctx.trace_id}] No active item found for Plaid item ID: ${input.plaid_item_id}`
    );

    return {
      item_found: false,
      item_doc_id: null,
      user_id: null,
      current_status: null,
      is_active: false,
      institution_name: null,
    };
  }

  const item_data = item.data;

  console.log(
    `[${ctx.trace_id}] Found item ${item.id} for Plaid item ID: ${input.plaid_item_id}`
  );

  return {
    item_found: true,
    item_doc_id: item.id,
    user_id: item_data.userId as string,
    current_status: (item_data.status as string) || "good",
    is_active: item_data.isActive !== false,
    institution_name: (item_data.institutionName as string) || null,
  };
}
