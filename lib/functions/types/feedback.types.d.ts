/**
 * Feedback-And-Questions — Zod input schemas, entities and response types.
 *
 * A note (`feedback/{noteId}`) NEVER carries who sent it: no uid, name or email (D2/D7). The
 * sender's own list lives in `feedback_senders/{uid}` (note ids + the daily counter), which only
 * functions read.
 *
 * @module types/feedback
 */
import { z } from "zod";
/** The six starters (D3): the chip the sender picked, saved as the note's type. */
export declare const FEEDBACK_TYPES: readonly ["idea", "howTo", "bug", "needThisToo", "question", "other"];
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
/** D8: longest note, in UTF-16 units (what the app's TextInput maxLength counts). */
export declare const MAX_FEEDBACK_LENGTH = 5000;
/** D8: notes one person can send per UTC day. */
export declare const MAX_FEEDBACK_PER_DAY = 20;
/** Bounds `feedback_senders.noteIds` (rule #9): the Sent tab shows the newest this many. */
export declare const MAX_SENDER_NOTE_IDS = 200;
/** The owner inbox reads at most this many notes per status (newest first). */
export declare const MAX_INBOX_NOTES = 300;
/** Owner allowlist for the inbox (`_feature_flags/feedback_inbox_v1`, enabled_user_ids ONLY). */
export declare const FEEDBACK_INBOX_FLAG = "feedback_inbox_v1";
/** Client-made note id (dedupes a retried send): Firestore-safe, unguessable length. */
export declare const NOTE_ID_PATTERN: RegExp;
/**
 * The starters' opening words (D4), trimmed — must match the app's `STARTERS[].prefill`. A note
 * that is only one of these says nothing, so the server refuses it like an empty note.
 */
export declare const STARTER_OPENINGS: readonly string[];
/**
 * Invisible formatting characters stripped from notes: C1 controls, zero-width space, word joiner,
 * BOM and bidi embeddings / overrides / isolates. (ZWJ / ZWNJ stay: emoji sequences need them.)
 */
export declare const INVISIBLE_CHAR: RegExp;
export declare const submit_feedback_input_schema: z.ZodObject<{
    note_id: z.ZodString;
    type: z.ZodEnum<{
        other: "other";
        idea: "idea";
        howTo: "howTo";
        bug: "bug";
        needThisToo: "needThisToo";
        question: "question";
    }>;
    message: z.ZodString;
    app_version: z.ZodPipe<z.ZodString, z.ZodString>;
    build: z.ZodPipe<z.ZodString, z.ZodString>;
    screen: z.ZodOptional<z.ZodString>;
    device: z.ZodOptional<z.ZodString>;
    os_version: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SubmitFeedbackInput = z.infer<typeof submit_feedback_input_schema>;
export declare const feedback_inbox_input_schema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"list">;
    status: z.ZodDefault<z.ZodEnum<{
        open: "open";
        done: "done";
    }>>;
    type: z.ZodOptional<z.ZodEnum<{
        other: "other";
        idea: "idea";
        howTo: "howTo";
        bug: "bug";
        needThisToo: "needThisToo";
        question: "question";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"mark_read">;
    note_id: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"set_status">;
    note_id: z.ZodString;
    status: z.ZodEnum<{
        open: "open";
        done: "done";
    }>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"delete">;
    note_id: z.ZodString;
}, z.core.$strip>], "action">;
export type FeedbackInboxInput = z.infer<typeof feedback_inbox_input_schema>;
export type FeedbackStatus = "open" | "done";
/** A stored note. No sender field exists, by design. */
export interface FeedbackNote {
    id: string;
    type: FeedbackType;
    message: string;
    app_version: string;
    build: string;
    screen: string | null;
    device: string | null;
    os_version: string | null;
    created_at_ms: number;
    status: FeedbackStatus;
    read_by_owner: boolean;
    /** v2 (D11): the team's reply. Never written in v1. */
    reply: {
        message: string;
        replied_at_ms: number;
    } | null;
}
/** `feedback_senders/{uid}`: the sender's own note ids (newest first) + the daily counter. */
export interface FeedbackSender {
    note_ids: string[];
    daily_count: number;
    /** UTC day (`YYYY-MM-DD`) that `daily_count` counts. */
    daily_date: string;
    /**
     * Ids of this sender's notes the owner deleted (newest first, bounded). A late retry of a
     * deleted note is a no-op instead of bringing it back.
     */
    retired_note_ids: string[];
}
/** What the sender sees in Sent: their note, never inbox state (open/done/read). */
export interface MyFeedbackItem {
    id: string;
    type: FeedbackType;
    message: string;
    created_at_ms: number;
    reply: {
        message: string;
        replied_at_ms: number;
    } | null;
}
/** What the owner sees in the inbox: the note + device facts, never a sender. */
export type InboxFeedbackItem = Omit<FeedbackNote, never>;
export interface SubmitFeedbackResult {
    note_id: string;
    /** True when this note id was already sent (a retried send) — nothing new was written. */
    deduped: boolean;
    /** Notes left today after this one. */
    remaining_today: number;
}
export interface ListMyFeedbackResult {
    notes: MyFeedbackItem[];
}
export interface FeedbackStatusResult {
    is_owner: boolean;
    /** Owner only: notes the owner hasn't opened yet (0 for everyone else). */
    inbox_unread: number;
}
export type FeedbackInboxResult = {
    action: "list";
    notes: InboxFeedbackItem[];
    truncated: boolean;
} | {
    action: "mark_read" | "set_status" | "delete";
    note_id: string;
    changed: boolean;
};
//# sourceMappingURL=feedback.types.d.ts.map