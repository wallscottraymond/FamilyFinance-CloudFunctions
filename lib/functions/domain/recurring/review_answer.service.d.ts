/**
 * Answering a "Bills to review" item (Convert-To-Recurring D9 / D14 / D15 / D24 / X4 / X8) — PURE.
 *
 * Phase 1 answers:
 *   suggested (Plaid)    → `track` (the next sync creates the v2 bill — with the schedule the user
 *                          picked when Plaid said UNKNOWN, D8) | `not_bill` (vendor remembered)
 *   suggested (detector) → `not_bill` only (tracking a detector suggestion is Phase 2: convert)
 *   still_a_bill         → `still_a_bill` (remembered on the record) | `it_ended` (going-forward end)
 *   same_bill            → `keep_separate` (the next sync creates the new stream's own bill);
 *                          `same_bill` (merge) is Phase 2
 *
 * Idempotent (R12): answering an item again with the SAME answer is a no-op; a different answer on
 * an answered item is refused. Answers that must survive the review item's TTL live on the record
 * (end interval / `plaidInactiveAckAt`) or in the review state ("Not a bill" vendors, held-out ids).
 *
 * @module domain/recurring/review_answer
 */
import { ReviewItem, ReviewStateChange } from "./review_item.service";
export type UserAnswer = "track" | "not_bill" | "still_a_bill" | "it_ended" | "keep_separate" | "same_bill";
export interface ReviewAnswerPlan {
    /** Already answered this way: nothing to write. */
    no_op: boolean;
    /** The item, closed with the answer (null when no_op). */
    item: ReviewItem | null;
    state_change: ReviewStateChange;
    /** What happens to the record the question is about. */
    record_action: "ack_still_a_bill" | "end" | null;
    /** Re-sync the item so the planner creates the bill now ("track" / "keep separate"). */
    resync_item_doc_id: string | null;
    /** "Same bill": the old bill ends and is merged into the new stream's bill (D7 / D22). */
    merge: {
        old_record_id: string;
        into_stream_id: string;
    } | null;
    /** A detector suggestion tracked: made a bill by the convert path (the item closes `converted`). */
    convert: boolean;
}
export type ReviewAnswerResult = {
    ok: true;
    plan: ReviewAnswerPlan;
} | {
    ok: false;
    error: string;
};
/** Plan an answer. PURE. */
export declare function plan_review_answer(item: ReviewItem, answer: UserAnswer, now_ms: number, opts?: {
    frequency?: string | null;
}): ReviewAnswerResult;
//# sourceMappingURL=review_answer.service.d.ts.map