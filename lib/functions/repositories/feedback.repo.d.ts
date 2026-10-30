/**
 * Feedback Repository (Feedback-And-Questions)
 *
 * - `feedback/{noteId}`: one note. Has NO sender field (D2/D7) — never add one.
 * - `feedback_senders/{uid}`: the sender's own note ids (newest first, bounded) + daily counter.
 *
 * Functions-only: the rules deny every client read and write on both.
 *
 * @module repositories/feedback
 */
import { TraceContext } from "../types";
import { FeedbackNote, FeedbackSender, FeedbackStatus, FeedbackType } from "../types/feedback.types";
export declare const FEEDBACK_COLLECTION = "feedback";
export declare const FEEDBACK_SENDERS_COLLECTION = "feedback_senders";
/** What the send transaction's plan returns: write the pair, or don't write. */
export type SubmitWrite<R> = {
    write: {
        note: FeedbackNote;
        sender: FeedbackSender;
    } | null;
    result: R;
};
export declare const feedback_repo: {
    /**
     * The send, atomically: read the sender record + whether the note id exists, let the (pure)
     * plan decide, then write the note and the sender record together — or nothing. `create` (not
     * `set`) on the note is a second guard: an id that appeared since the read fails the commit and
     * the transaction retries against the fresh snapshot.
     */
    submit_in_transaction<R>(_ctx: TraceContext, user_id: string, note_id: string, plan: (sender: FeedbackSender | null, note_exists: boolean) => SubmitWrite<R>): Promise<R>;
    get_sender(_ctx: TraceContext, user_id: string): Promise<FeedbackSender | null>;
    /** Notes by id (missing ids are skipped). */
    get_notes(_ctx: TraceContext, note_ids: string[]): Promise<FeedbackNote[]>;
    get_note(_ctx: TraceContext, note_id: string): Promise<FeedbackNote | null>;
    /**
     * Inbox page: notes with this status (and type, when given), newest first. Reads `limit + 1` so
     * the caller knows whether more exist. Indexes: (status, createdAt desc) and
     * (status, type, createdAt desc).
     */
    list_inbox(_ctx: TraceContext, status: FeedbackStatus, type: FeedbackType | undefined, limit: number): Promise<{
        notes: FeedbackNote[];
        truncated: boolean;
    }>;
    /** Notes the owner hasn't opened (aggregation: one read per 1,000 notes). */
    count_unread(_ctx: TraceContext): Promise<number>;
    /**
     * Set inbox fields on a note. Returns false when the note doesn't exist (nothing written) or
     * already has these values (nothing written — no needless write).
     */
    update_note_fields(_ctx: TraceContext, note_id: string, fields: {
        status?: FeedbackStatus;
        read_by_owner?: boolean;
    }): Promise<boolean>;
    /**
     * Delete a note and take its id off whichever sender list holds it (found by array-contains —
     * the note itself never says who sent it). `next` computes the sender's new record (list +
     * retired ids). Returns false when the note was already gone.
     */
    delete_note(_ctx: TraceContext, note_id: string, next: (sender: FeedbackSender) => FeedbackSender): Promise<boolean>;
};
//# sourceMappingURL=feedback.repo.d.ts.map