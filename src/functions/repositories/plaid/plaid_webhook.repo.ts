/**
 * Plaid Webhook Repository
 *
 * Persistence for the `plaid_webhooks` audit collection — records that a webhook
 * was processed (for dedup/observability). Append-only; no business logic.
 *
 * @module repositories/plaid/plaid_webhook
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { WebhookBalanceSyncInput } from "../../types/plaid/webhook_balance_sync.types";

const COLLECTION = "plaid_webhooks";

export const plaid_webhook_repo = {
  /**
   * Records a webhook as processed. Best-effort: a failure here is logged but
   * never thrown (webhook recording is not critical to the main operation).
   */
  async record_processed(
    ctx: TraceContext,
    input: WebhookBalanceSyncInput,
    success: boolean,
    message: string
  ): Promise<void> {
    try {
      /* eslint-disable @typescript-eslint/naming-convention */
      await getFirestore().collection(COLLECTION).add({
        webhookType: input.webhook_type,
        webhookCode: input.webhook_code,
        itemId: input.plaid_item_id,
        requestId: input.request_id || "",
        processingStatus: success ? "completed" : "failed",
        processedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        traceId: ctx.trace_id,
        result: message,
      });
      /* eslint-enable @typescript-eslint/naming-convention */
    } catch (error) {
      console.error(
        `[${ctx.trace_id}] Failed to record webhook processing:`,
        error
      );
    }
  },
};
