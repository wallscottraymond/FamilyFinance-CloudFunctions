/**
 * Retry Transient Item Errors Orchestrator
 *
 * Background auto-retry for Plaid items in a transient error state (institution
 * down / rate limited). For each such item it runs a fresh balance-sync probe:
 *  - success            → clear the error, mark the connection healthy (silent)
 *  - failure < 24h       → keep retrying silently (no user-facing change)
 *  - failure ≥ 24h       → escalate to the user as needing a reconnect
 *
 * Invoked from the scheduled entry every 4 hours. Items that recover or escalate
 * leave the transient status, so they are not reprocessed.
 *
 * @module orchestrators/plaid/retry_transient_item_errors
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  resolve_transient_items_to_retry,
} from "../../resolvers/plaid/transient_item_errors.resolver";
import { decide_retry_action } from "../../domain/plaid/transient_error_retry.service";
import {
  compute_login_repaired_update,
  compute_escalation_update,
} from "../../domain/plaid/item_status_webhook.service";
import { sync_balances_orchestrator } from "./sync_balances.orchestrator";
import {
  RetryTransientErrorsResponse,
  SURFACE_AFTER_MS,
  TransientItemToRetry,
} from "../../types/plaid/transient_error_retry.types";

/**
 * Probes one item with a balance sync. Returns whether the connection is
 * working again. Never throws — a failed/erroring sync means "still down".
 */
async function probe_item(
  ctx: TraceContext,
  span_id: string,
  item: TransientItemToRetry
): Promise<boolean> {
  try {
    const result = await sync_balances_orchestrator({
      trace_id: ctx.trace_id,
      span_id,
      input: { item_id: item.plaid_item_id },
      user_id: item.user_id,
      idempotency_key: `transient_retry:${item.item_doc_id}:${Timestamp.now().toMillis()}`,
    });
    // Recovery requires THIS item to actually sync — the aggregate `success`
    // can be true even when the item's token won't decrypt / it synced nothing.
    const item_result = result.items?.find(
      (i) => i.item_id === item.plaid_item_id
    );
    return item_result?.success === true && !item_result.error;
  } catch {
    return false;
  }
}

/**
 * Runs one auto-retry pass over all items in a transient error state.
 *
 * @param ctx - Trace context
 * @returns Aggregated counts for the run
 */
export async function retry_transient_item_errors_orchestrator(
  ctx: TraceContext
): Promise<RetryTransientErrorsResponse> {
  const span = create_span(ctx, "orchestrator", "retry_transient_item_errors");
  log_operation_start(span, "system");

  const db = getFirestore();
  const response: RetryTransientErrorsResponse = {
    processed: 0,
    recovered: 0,
    still_waiting: 0,
    escalated: 0,
  };

  try {
    // 1. RESOLVER: items currently in a transient state.
    const items = await resolve_transient_items_to_retry(ctx);

    // 2. For each item: probe → decide → apply.
    for (const item of items) {
      response.processed++;

      const sync_succeeded = await probe_item(ctx, span.span_id, item);
      const now_ms = Timestamp.now().toMillis();
      const transient_since_ms = item.transient_since
        ? item.transient_since.toMillis()
        : null;

      const action = decide_retry_action({
        transient_since_ms,
        now_ms,
        sync_succeeded,
        surface_after_ms: SURFACE_AFTER_MS,
      });

      const item_ref = db.collection("plaid_items").doc(item.item_doc_id);

      /* eslint-disable @typescript-eslint/naming-convention */
      if (action === "recovered") {
        const update = compute_login_repaired_update();
        await item_ref.update({
          status: update.status,
          error: null,
          errorMessage: null,
          errorAt: null,
          requiresReauth: false,
          consentExpiresAt: null,
          transientSince: null,
          retryCount: 0,
          lastRetryAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        response.recovered++;
      } else if (action === "escalate") {
        const update = compute_escalation_update(item.error_code);
        await item_ref.update({
          status: update.status,
          error: update.error_code,
          errorMessage: update.error_message,
          errorAt: update.error_at,
          requiresReauth: true,
          consentExpiresAt: null,
          transientSince: null,
          lastRetryAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        response.escalated++;
      } else {
        // keep_waiting — stay silent; bump retry bookkeeping. Start the
        // surface clock if it was never anchored.
        const patch: Record<string, unknown> = {
          retryCount: FieldValue.increment(1),
          lastRetryAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (transient_since_ms === null) {
          patch.transientSince = FieldValue.serverTimestamp();
        }
        await item_ref.update(patch);
        response.still_waiting++;
      }
      /* eslint-enable @typescript-eslint/naming-convention */
    }

    log_operation_success(span, "system");
    return response;
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: "system", error_code: "RETRY_TRANSIENT_ERRORS_FAILED" }
    );
    throw error;
  }
}
