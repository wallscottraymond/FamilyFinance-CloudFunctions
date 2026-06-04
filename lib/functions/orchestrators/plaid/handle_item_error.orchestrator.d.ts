/**
 * Handle Item Error Orchestrator
 *
 * Processes ITEM.ERROR and ITEM.PENDING_EXPIRATION webhooks.
 * Updates item status and error details in Firestore.
 *
 * @module orchestrators/plaid/handle_item_error
 */
import { OrchestratorContext } from "../../types";
import { ItemStatusWebhookInput, ItemStatusWebhookResponse } from "../../types/plaid/item_status_webhook.types";
/**
 * Orchestrates handling of ITEM.ERROR, ITEM.PENDING_EXPIRATION,
 * and ITEM.USER_PERMISSION_REVOKED webhooks.
 *
 * Flow:
 * 1. Resolver: Find item by Plaid item ID
 * 2. Domain Service: Compute status update
 * 3. Repository: Update item status
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Response indicating success/failure
 */
export declare function handle_item_error_orchestrator(ctx: OrchestratorContext<ItemStatusWebhookInput>): Promise<ItemStatusWebhookResponse>;
//# sourceMappingURL=handle_item_error.orchestrator.d.ts.map