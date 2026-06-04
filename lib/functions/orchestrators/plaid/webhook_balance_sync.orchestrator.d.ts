/**
 * Webhook Balance Sync Orchestrator
 *
 * Coordinates balance synchronization triggered by Plaid webhooks.
 * Reuses the same underlying functions as on-demand sync for consistency.
 *
 * Flow:
 * 1. Resolver: Find plaid_item, check idempotency
 * 2. Integration: Fetch accounts/balances from Plaid
 * 3. Repository: Upsert accounts (create if new, update balances if exists)
 * 4. Events: Emit balance_updated events for changes
 * 5. Record webhook as processed
 *
 * @module orchestrators/plaid/webhook_balance_sync
 */
import { OrchestratorContext } from "../../types";
import { WebhookBalanceSyncInput, WebhookBalanceSyncResponse } from "../../types/plaid";
/**
 * Orchestrates webhook-triggered balance synchronization.
 *
 * This orchestrator:
 * - Is triggered by Plaid webhooks (NEW_ACCOUNTS_AVAILABLE, etc.)
 * - Reuses the same upsert_from_plaid() logic as on-demand sync
 * - Has tighter performance budget (webhooks need fast response)
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Sync results with updated accounts
 */
export declare function webhook_balance_sync_orchestrator(ctx: OrchestratorContext<WebhookBalanceSyncInput>): Promise<WebhookBalanceSyncResponse>;
//# sourceMappingURL=webhook_balance_sync.orchestrator.d.ts.map