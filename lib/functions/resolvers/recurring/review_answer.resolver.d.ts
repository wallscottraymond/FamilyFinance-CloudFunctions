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
import { RecurringReviewState, ReviewItem } from "../../domain/recurring/review_item.service";
export type ReviewAnswerContext = {
    ok: true;
    item: ReviewItem;
    state: RecurringReviewState | null;
    record_owner_ok: boolean;
} | {
    ok: false;
    reason: "not_found" | "permission_denied";
};
export declare function resolve_review_answer_context(ctx: TraceContext, user_id: string, item_id: string): Promise<ReviewAnswerContext>;
//# sourceMappingURL=review_answer.resolver.d.ts.map