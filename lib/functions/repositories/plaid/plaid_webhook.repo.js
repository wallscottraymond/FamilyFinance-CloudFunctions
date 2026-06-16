"use strict";
/**
 * Plaid Webhook Repository
 *
 * Persistence for the `plaid_webhooks` audit collection — records that a webhook
 * was processed (for dedup/observability). Append-only; no business logic.
 *
 * @module repositories/plaid/plaid_webhook
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaid_webhook_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "plaid_webhooks";
exports.plaid_webhook_repo = {
    /**
     * Records a webhook as processed. Best-effort: a failure here is logged but
     * never thrown (webhook recording is not critical to the main operation).
     */
    async record_processed(ctx, input, success, message) {
        try {
            /* eslint-disable @typescript-eslint/naming-convention */
            await (0, firestore_1.getFirestore)().collection(COLLECTION).add({
                webhookType: input.webhook_type,
                webhookCode: input.webhook_code,
                itemId: input.plaid_item_id,
                requestId: input.request_id || "",
                processingStatus: success ? "completed" : "failed",
                processedAt: firestore_1.Timestamp.now(),
                createdAt: firestore_1.Timestamp.now(),
                traceId: ctx.trace_id,
                result: message,
            });
            /* eslint-enable @typescript-eslint/naming-convention */
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] Failed to record webhook processing:`, error);
        }
    },
};
//# sourceMappingURL=plaid_webhook.repo.js.map