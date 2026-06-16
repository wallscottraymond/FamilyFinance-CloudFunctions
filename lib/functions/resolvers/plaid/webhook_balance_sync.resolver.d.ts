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
import { TraceContext } from "../../types";
import { WebhookBalanceSyncInput, WebhookBalanceSyncDependencies } from "../../types/plaid";
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
export declare function resolve_webhook_balance_sync_dependencies(ctx: TraceContext, input: WebhookBalanceSyncInput): Promise<WebhookBalanceSyncDependencies>;
//# sourceMappingURL=webhook_balance_sync.resolver.d.ts.map