/**
 * Plaid Webhook Repository
 *
 * Persistence for the `plaid_webhooks` audit collection — records that a webhook
 * was processed (for dedup/observability). Append-only; no business logic.
 *
 * @module repositories/plaid/plaid_webhook
 */
import { TraceContext } from "../../types";
import { WebhookBalanceSyncInput } from "../../types/plaid/webhook_balance_sync.types";
export declare const plaid_webhook_repo: {
    /**
     * Records a webhook as processed. Best-effort: a failure here is logged but
     * never thrown (webhook recording is not critical to the main operation).
     */
    record_processed(ctx: TraceContext, input: WebhookBalanceSyncInput, success: boolean, message: string): Promise<void>;
};
//# sourceMappingURL=plaid_webhook.repo.d.ts.map