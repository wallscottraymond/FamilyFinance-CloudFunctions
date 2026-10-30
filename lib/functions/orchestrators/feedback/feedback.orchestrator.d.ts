/**
 * Feedback orchestrators (Feedback-And-Questions)
 *
 * - send: resolver (no dependencies) → domain plan inside the repo transaction → one atomic write.
 *   The client-made note id IS the idempotency key: a retried send finds its own note and returns
 *   "deduped" without writing, so no separate idempotency record is kept.
 * - Sent tab: the sender's own list (read-only).
 * - status: is the caller an inbox owner, and how many notes are unread (owner only).
 * - inbox: owner-only list / mark read / open-done / delete. A non-owner gets PERMISSION_DENIED
 *   and never reads a note.
 *
 * @module orchestrators/feedback/feedback
 */
import { OrchestratorContext, TraceContext } from "../../types";
import { FeedbackInboxInput, FeedbackInboxResult, FeedbackStatusResult, ListMyFeedbackResult, SubmitFeedbackInput, SubmitFeedbackResult } from "../../types/feedback.types";
/** Orchestrator outcome: data, or a client-facing refusal (code + message). */
export type FeedbackOutcome<T> = {
    success: true;
    data: T;
} | {
    success: false;
    code: string;
    message: string;
};
export declare function submit_feedback_orchestrator(ctx: OrchestratorContext<SubmitFeedbackInput>, now_ms?: number): Promise<FeedbackOutcome<SubmitFeedbackResult>>;
export declare function list_my_feedback_orchestrator(ctx: TraceContext, user_id: string): Promise<ListMyFeedbackResult>;
export declare function feedback_status_orchestrator(ctx: TraceContext, user_id: string): Promise<FeedbackStatusResult>;
export declare function feedback_inbox_orchestrator(ctx: OrchestratorContext<FeedbackInboxInput>): Promise<FeedbackOutcome<FeedbackInboxResult>>;
//# sourceMappingURL=feedback.orchestrator.d.ts.map