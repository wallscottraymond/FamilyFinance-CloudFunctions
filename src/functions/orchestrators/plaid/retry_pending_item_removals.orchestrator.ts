/**
 * Retry Pending Item Removals Orchestrator
 *
 * When an account removal's Plaid `itemRemove` failed, the item stays connected
 * at Plaid (and billed) and is flagged `removalPending`. This retries the
 * removal and, on success, soft-deletes the item. Runs from the 4h scheduled job.
 *
 * @module orchestrators/plaid/retry_pending_item_removals
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { resolve_pending_item_removals } from "../../resolvers/plaid/pending_item_removal.resolver";
import { remove_item } from "../../integrations/plaid";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";

/** Counts for one retry pass. */
export interface RetryPendingItemRemovalsResult {
  attempted: number;
  removed: number;
  still_pending: number;
}

/**
 * Retries Plaid removal for every flagged item.
 *
 * @param ctx - Trace context
 * @returns Counts for the run
 */
export async function retry_pending_item_removals_orchestrator(
  ctx: TraceContext
): Promise<RetryPendingItemRemovalsResult> {
  const span = create_span(ctx, "orchestrator", "retry_pending_item_removals");
  log_operation_start(span, "system");

  const result: RetryPendingItemRemovalsResult = { attempted: 0, removed: 0, still_pending: 0 };

  const items = await resolve_pending_item_removals(ctx);
  for (const item of items) {
    result.attempted++;
    let removed = false;
    if (item.access_token) {
      try {
        removed = (await remove_item(item.access_token)).success;
      } catch (error) {
        console.warn(`[${ctx.trace_id}] Retry itemRemove failed for ${item.item_doc_id}:`, error);
      }
    }
    if (!removed) {
      result.still_pending++;
      continue;
    }
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    await plaid_item_repo.apply_field_update(ctx, item.item_doc_id, { removalPending: false });
    await plaid_item_repo.soft_delete(ctx, item.item_doc_id, item.user_id);
    result.removed++;
  }

  log_operation_success(span, "system");
  return result;
}
