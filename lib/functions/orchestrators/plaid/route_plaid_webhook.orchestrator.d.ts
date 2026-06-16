/**
 * Route Plaid Webhook Orchestrator
 *
 * The single orchestrator the `plaid_webhook` HTTP entry calls. Routes a
 * verified webhook to the right handler by type/code: balance sync, item
 * error/expiration/permission, login repaired, or transaction sync. Resolves
 * dependencies (for the transaction-sync case) and fans out to the relevant
 * sub-orchestrators. The entry keeps only protocol concerns (method check,
 * signature verification, trace creation, response mapping).
 *
 * @module orchestrators/plaid/route_plaid_webhook
 */
import { TraceContext } from "../../types";
/** Webhook body fields used by the item-status handlers. */
export interface ItemStatusWebhookBody {
    consent_expiration_time?: string;
    error?: {
        error_type: string;
        error_code: string;
        error_message: string;
        display_message: string | null;
    };
}
/** Parsed, signature-verified webhook the entry hands to the orchestrator. */
export interface RoutePlaidWebhookInput {
    webhook_type: string;
    webhook_code: string;
    plaid_item_id: string;
    request_id: string | undefined;
    webhook_body: ItemStatusWebhookBody;
}
export declare function route_plaid_webhook_orchestrator(ctx: TraceContext, input: RoutePlaidWebhookInput): Promise<{
    processed: boolean;
    message: string;
}>;
//# sourceMappingURL=route_plaid_webhook.orchestrator.d.ts.map