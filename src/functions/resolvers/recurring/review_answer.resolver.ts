/**
 * Review Answer Resolver — READ-ONLY context for answering a review item (D15 / D24).
 *
 * Authorization is by OWNER (never by group): an item id is `${owner_uid}__…`, the stored item's
 * `userId` must be the caller, and the id must be exactly the one rebuilt from the caller's uid +
 * the item's kind + subject (a client-supplied id is never trusted). A question about a record also
 * requires the caller to own that record. A group member answering the owner's item → denied.
 *
 * @module resolvers/recurring/review_answer
 */

import { TraceContext } from "../../types";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { inflow_repo, outflow_repo } from "../../repositories";
import {
  RecurringReviewState,
  ReviewItem,
  build_review_item_id,
  owner_of_review_item_id,
} from "../../domain/recurring/review_item.service";

export type ReviewAnswerContext =
  | { ok: true; item: ReviewItem; state: RecurringReviewState | null; record_owner_ok: boolean }
  | { ok: false; reason: "not_found" | "permission_denied" };

export async function resolve_review_answer_context(
  ctx: TraceContext,
  user_id: string,
  item_id: string
): Promise<ReviewAnswerContext> {
  if (owner_of_review_item_id(item_id) !== user_id) return { ok: false, reason: "permission_denied" };
  const item = await recurring_review_repo.get_item(ctx, item_id);
  if (!item) return { ok: false, reason: "not_found" };
  if (item.user_id !== user_id) return { ok: false, reason: "permission_denied" };
  if (build_review_item_id(user_id, item.kind, item.subject_key) !== item_id) {
    return { ok: false, reason: "permission_denied" };
  }
  let record_owner_ok = true;
  // The record the answer acts on must be the caller's too: "Still a bill" / "It ended" write it,
  // and "Keep separate" decides about it (same bill: the stopped bill) — D24 / X16.
  if (item.record_id && (item.kind === "still_a_bill" || item.kind === "same_bill")) {
    const repo = item.direction === "outflow" ? outflow_repo : inflow_repo;
    const record = await repo.get_by_id(ctx, item.record_id, { include_deleted: true });
    record_owner_ok = !!record && record.user_id === user_id;
  }
  const state = await recurring_review_repo.get_state(ctx, user_id);
  return { ok: true, item, state, record_owner_ok };
}
