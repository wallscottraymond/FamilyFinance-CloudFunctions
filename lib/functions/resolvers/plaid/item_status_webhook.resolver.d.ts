/**
 * Item Status Webhook Resolver
 *
 * Gathers dependencies for item status webhook processing.
 * Looks up the Plaid item by Plaid's item ID (not our document ID).
 *
 * @module resolvers/plaid/item_status_webhook
 */
import { TraceContext } from "../../types";
import { ResolveItemStatusWebhookInput, ItemStatusWebhookDependencies } from "../../types/plaid/item_status_webhook.types";
/**
 * Resolves dependencies for item status webhook processing.
 *
 * @param ctx - Trace context
 * @param input - Resolution input with Plaid item ID
 * @returns Resolved dependencies
 */
export declare function resolve_item_status_webhook_dependencies(ctx: TraceContext, input: ResolveItemStatusWebhookInput): Promise<ItemStatusWebhookDependencies>;
//# sourceMappingURL=item_status_webhook.resolver.d.ts.map