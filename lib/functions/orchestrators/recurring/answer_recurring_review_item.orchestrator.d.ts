/**
 * Answer Recurring Review Item Orchestrator (Convert-To-Recurring Phase 1, D9 / D14 / D24).
 *
 * One tap on a Bills-to-review tile (period page or the list — they read the same item):
 *   resolve (owner-only auth) → plan (pure) → write the item + the review state (only if changed;
 *   a held-out-set change bumps the derive version) → the record action ("Still a bill" ack on the
 *   record; "It ended" = the going-forward end, via the removal orchestrator) → for "track" /
 *   "keep separate" a re-sync of the item, so its planner creates the v2 bill now (one sync path:
 *   stamping, periods, linking, follow-ups all as for any new bill).
 *
 * Flag-gated (X11): with the flag off the callable refuses. Idempotent: the same answer again is a
 * no-op (R12).
 *
 * @module orchestrators/recurring/answer_recurring_review_item
 */
import { TraceContext } from "../../types";
import { UserAnswer } from "../../domain/recurring/review_answer.service";
export interface AnswerReviewItemInput {
    item_id: string;
    answer: UserAnswer;
    /** The schedule picked when tracking a Plaid suggestion with an UNKNOWN frequency (D8). */
    frequency?: string | null;
    /** Detector "Track": the confirm sheet's values (defaults come from the suggestion). */
    name?: string;
    amount?: number;
    next_due_date?: string;
}
export interface AnswerReviewItemResult {
    item_id: string;
    status: string;
    answer: string;
    no_op: boolean;
    /** "converted" only: the bill exists but is still being finished — the item stays open; ask again. */
    in_progress?: boolean;
    /** "converted" only: the bill / income it made (the app tags it NEW — D48). */
    record_id?: string;
    direction?: "outflow" | "inflow";
}
export declare function answer_recurring_review_item_orchestrator(ctx: TraceContext, user_id: string, input: AnswerReviewItemInput, now_ms: number): Promise<AnswerReviewItemResult>;
//# sourceMappingURL=answer_recurring_review_item.orchestrator.d.ts.map