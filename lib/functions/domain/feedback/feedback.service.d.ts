/**
 * Feedback domain service (Feedback-And-Questions) — PURE: no IO, no clock, no logging.
 *
 * Decides what a send does (write / already sent / refused), builds the stored note (never a
 * sender), keeps the sender's list bounded, and maps notes to what the sender and the owner see.
 *
 * @module domain/feedback/feedback.service
 */
import { FeedbackNote, FeedbackSender, InboxFeedbackItem, MyFeedbackItem, SubmitFeedbackInput } from "../../types/feedback.types";
/** UTC calendar day (`YYYY-MM-DD`) of an instant — the daily limit's day. */
export declare function utc_day(now_ms: number): string;
/**
 * The note text as stored: CRLF/CR → LF, every control character except newline and tab removed,
 * invisible formatting characters removed, surrounding whitespace trimmed. Null when nothing
 * visible is left (whitespace / ZWJ / ZWNJ alone count as nothing).
 */
export declare function normalize_message(message: string): string | null;
/** True when the note is only a starter's opening words (D4) — nothing written yet. */
export declare function is_bare_starter(message: string): boolean;
/** Notes already counted today (a counter from an earlier day counts as 0). */
export declare function sent_today(sender: FeedbackSender | null, day: string): number;
export type SubmitPlan = {
    kind: "write";
    note: FeedbackNote;
    sender: FeedbackSender;
    remaining_today: number;
} | {
    kind: "deduped";
    remaining_today: number;
} | {
    kind: "rejected";
    code: "EMPTY" | "TOO_LONG" | "DAILY_LIMIT" | "ID_TAKEN";
    message: string;
};
/**
 * What a send does, given the sender's record and whether the note id already exists. Runs inside
 * the send's transaction, so the limit and the dedupe see one consistent snapshot.
 *
 * - The id exists and is in the sender's own list → a retried send: nothing written ("deduped").
 * - The id exists but isn't theirs → refused (never overwrite someone else's note).
 * - The owner deleted it (id retired on their record) → a late retry: nothing written ("deduped").
 * - Empty or only a starter's words after cleanup, or over the length limit → refused.
 * - 20 already sent this UTC day → refused.
 */
export declare function plan_submit(input: SubmitFeedbackInput, sender: FeedbackSender | null, note_exists: boolean, now_ms: number): SubmitPlan;
/** The sender record after one more note: newest id first, no duplicates, bounded (rule #9). */
export declare function next_sender(sender: FeedbackSender | null, note_id: string, day: string): FeedbackSender;
/** The sender's id list without one note (the owner deleted it). */
export declare function without_note(note_ids: string[], note_id: string): string[];
/** The sender record after the owner deletes one of their notes: off the list, id retired. */
export declare function after_owner_delete(sender: FeedbackSender, note_id: string): FeedbackSender;
/** Sent tab: the sender's notes in their list order (newest first); deleted notes drop out. */
export declare function to_my_items(note_ids: string[], notes: FeedbackNote[]): MyFeedbackItem[];
/** Inbox: exactly the stored note fields. There is no sender to leak — the note has none. */
export declare function to_inbox_item(note: FeedbackNote): InboxFeedbackItem;
/** Minimal shape of the inbox allowlist flag (`_feature_flags/feedback_inbox_v1`). */
export interface InboxFlagLike {
    enabled?: unknown;
    enabled_user_ids?: unknown;
}
/**
 * Is this user an inbox owner? ONLY an explicit allowlist entry on an enabled flag counts —
 * `rollout_percentage` and group ids are ignored on purpose, so a mistaken rollout can never open
 * every sender's notes to everyone.
 */
export declare function is_inbox_owner(flag: InboxFlagLike | null, user_id: string): boolean;
//# sourceMappingURL=feedback.service.d.ts.map