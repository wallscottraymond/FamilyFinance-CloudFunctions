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
import { account_repo } from "../../repositories/account.repo";
import { RecurringReviewState, ReviewItem } from "../../domain/recurring/review_item.service";
import { CaptureRecordInfo, to_capture_record_info } from "../plaid/recurring_sync.resolver";

export interface CaptureReviewContext {
  state: RecurringReviewState | null;
  items: Map<string, ReviewItem>;
}

export async function resolve_capture_review_context(
  ctx: TraceContext,
  user_id: string,
  review_ids: string[],
  plaid_item_doc_id?: string
): Promise<CaptureReviewContext> {
  const [state, items] = await Promise.all([
    recurring_review_repo.get_state(ctx, user_id),
    recurring_review_repo.get_items_by_ids(ctx, review_ids),
  ]);
  // Pending tracks of this Plaid item (or handed off by another item — round 4 defect 2) and the
  // open suggested tiles this item owns, whose item wasn't among the subjects in hand (the stream
  // is gone from the response): one more getAll, only then (≈ never in steady state).
  const missing = [
    ...(state?.pending_tracks ?? [])
      .filter((p) => p.plaid_item_doc_id === plaid_item_doc_id || typeof p.handed_off_ms === "number")
      .map((p) => p.item_id),
    ...(state?.suggested_owners ?? []).filter((o) => o.plaid_item_doc_id === plaid_item_doc_id).map((o) => o.item_id),
  ].filter((id) => !items.has(id));
  if (missing.length > 0) {
    for (const [id, item] of await recurring_review_repo.get_items_by_ids(ctx, missing)) items.set(id, item);
  }
  return { state, items };
}

/** The user's inactive bills + income (same-bill candidates) + their active Plaid account ids. */
export async function resolve_inactive_capture_records(
  ctx: TraceContext,
  user_id: string
): Promise<{ records: CaptureRecordInfo[]; active_account_ids: Set<string> }> {
  const [outflows, inflows, accounts] = await Promise.all([
    outflow_repo.get_inactive_by_user_id(ctx, user_id),
    inflow_repo.get_inactive_by_user_id(ctx, user_id),
    account_repo.get_by_user_id(ctx, user_id),
  ]);
  return {
    records: [
      ...outflows.map((o) => to_capture_record_info(o, "outflow", o.merchant_name)),
      ...inflows.map((i) => to_capture_record_info(i, "inflow", i.payer_name)),
    ],
    active_account_ids: new Set(
      accounts.filter((a) => a.is_active !== false).flatMap((a) => [a.account_id, a.id].filter(Boolean) as string[])
    ),
  };
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
