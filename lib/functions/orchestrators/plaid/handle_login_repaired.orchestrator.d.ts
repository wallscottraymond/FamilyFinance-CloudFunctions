/**
 * Handle Login Repaired Orchestrator
 *
 * Processes ITEM.LOGIN_REPAIRED webhooks.
 * Clears error state, updates status to healthy, and triggers data refresh.
 *
 * @module orchestrators/plaid/handle_login_repaired
 */
import { OrchestratorContext } from "../../types";
import { ItemStatusWebhookInput, ItemStatusWebhookResponse } from "../../types/plaid/item_status_webhook.types";
/**
 * Orchestrates handling of ITEM.LOGIN_REPAIRED webhooks.
 *
 * Flow:
 * 1. Resolver: Find item by Plaid item ID
 * 2. Domain Service: Compute status update (clear error)
 * 3. Repository: Update item status
 * 4. Repository: Mark relink attempts as successful
 * 5. (Optional) Trigger data refresh
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Response indicating success/failure
 */
export declare function handle_login_repaired_orchestrator(ctx: OrchestratorContext<ItemStatusWebhookInput>): Promise<ItemStatusWebhookResponse>;
//# sourceMappingURL=handle_login_repaired.orchestrator.d.ts.map