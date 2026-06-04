/**
 * Transient Item Errors Resolver
 *
 * READ-ONLY impact analysis for the auto-retry job: find the active Plaid items
 * currently sitting in a transient error state (institution down / rate limited)
 * that are candidates for a silent retry. No mutations.
 *
 * @module resolvers/plaid/transient_item_errors
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { ItemStatusValues } from "../../types/plaid/item_status_webhook.types";
import {
  TransientItemToRetry,
  MAX_ITEMS_PER_RUN,
} from "../../types/plaid/transient_error_retry.types";

/**
 * The transient statuses the retry job acts on.
 */
const TRANSIENT_STATUSES: string[] = [
  ItemStatusValues.TEMPORARY_ERROR,
  ItemStatusValues.RATE_LIMITED,
];

/**
 * Resolves the items awaiting a silent retry.
 *
 * @param ctx - Trace context
 * @returns Items in a transient error state (capped at MAX_ITEMS_PER_RUN)
 */
export async function resolve_transient_items_to_retry(
  ctx: TraceContext
): Promise<TransientItemToRetry[]> {
  const span = create_span(ctx, "resolver", "resolve_transient_items_to_retry");
  log_operation_start(span, "system");

  const items = await plaid_item_repo.get_in_transient_state(
    ctx,
    TRANSIENT_STATUSES
  );

  log_operation_success(span, "system");
  return items.slice(0, MAX_ITEMS_PER_RUN);
}
