/**
 * Recurring Capture Resolver (Convert-To-Recurring Phase 1) — READ-ONLY.
 *
 * What the capture planner needs beyond the sync's own reads, loaded only when the planner runs
 * (flag on, or the user has v2 records — X11):
 *   - the user's review state (ONE get, X8);
 *   - the review items at the deterministic ids of the subjects in this response (ONE getAll — no
 *     query, X8);
 *   - lazily, the user's INACTIVE records (same-bill candidates), only when a new v2 stream needs
 *     one (X9).
 *
 * @module resolvers/recurring/recurring_capture
 */

import { TraceContext } from "../../types";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { inflow_repo, outflow_repo } from "../../repositories";
import { RecurringReviewState, ReviewItem } from "../../domain/recurring/review_item.service";
import { CaptureRecordInfo, to_capture_record_info } from "../plaid/recurring_sync.resolver";

export interface CaptureReviewContext {
  state: RecurringReviewState | null;
  items: Map<string, ReviewItem>;
}

export async function resolve_capture_review_context(
  ctx: TraceContext,
  user_id: string,
  review_ids: string[]
): Promise<CaptureReviewContext> {
  const [state, items] = await Promise.all([
    recurring_review_repo.get_state(ctx, user_id),
    recurring_review_repo.get_items_by_ids(ctx, review_ids),
  ]);
  return { state, items };
}

/** The user's inactive bills + income (same-bill candidates), as planner records. */
export async function resolve_inactive_capture_records(
  ctx: TraceContext,
  user_id: string
): Promise<CaptureRecordInfo[]> {
  const [outflows, inflows] = await Promise.all([
    outflow_repo.get_inactive_by_user_id(ctx, user_id),
    inflow_repo.get_inactive_by_user_id(ctx, user_id),
  ]);
  return [
    ...outflows.map((o) => to_capture_record_info(o, "outflow", o.merchant_name)),
    ...inflows.map((i) => to_capture_record_info(i, "inflow", i.payer_name)),
  ];
}

/** Raw prefetched docs → planner records (no reads). */
export function capture_records_from_raw(
  outflow_docs: Map<string, Record<string, unknown>>,
  inflow_docs: Map<string, Record<string, unknown>>
): Map<string, CaptureRecordInfo> {
  const out = new Map<string, CaptureRecordInfo>();
  for (const [id, d] of outflow_docs) {
    const e = outflow_repo.entity_from_raw(d);
    out.set(id, to_capture_record_info(e, "outflow", e.merchant_name));
  }
  for (const [id, d] of inflow_docs) {
    const e = inflow_repo.entity_from_raw(d);
    out.set(id, to_capture_record_info(e, "inflow", e.payer_name));
  }
  return out;
}
