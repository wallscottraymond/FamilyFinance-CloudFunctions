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
export const FEEDBACK_TYPES = ["idea", "howTo", "bug", "needThisToo", "question", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** D8: longest note, in UTF-16 units (what the app's TextInput maxLength counts). */
export const MAX_FEEDBACK_LENGTH = 5000;
/** D8: notes one person can send per UTC day. */
export const MAX_FEEDBACK_PER_DAY = 20;
/** Bounds `feedback_senders.noteIds` (rule #9): the Sent tab shows the newest this many. */
export const MAX_SENDER_NOTE_IDS = 200;
/** The owner inbox reads at most this many notes per status (newest first). */
export const MAX_INBOX_NOTES = 300;

/** Owner allowlist for the inbox (`_feature_flags/feedback_inbox_v1`, enabled_user_ids ONLY). */
export const FEEDBACK_INBOX_FLAG = "feedback_inbox_v1";

/** Client-made note id (dedupes a retried send): Firestore-safe, unguessable length. */
export const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The starters' opening words (D4), trimmed — must match the app's `STARTERS[].prefill`. A note
 * that is only one of these says nothing, so the server refuses it like an empty note.
 */
export const STARTER_OPENINGS: readonly string[] = [
  "It would be cool if",
  "I don't know how to",
  "I found a bug:",
  "I need this too…",
  "I just have a question…",
];

/**
 * Invisible formatting characters stripped from notes: C1 controls, zero-width space, word joiner,
 * BOM and bidi embeddings / overrides / isolates. (ZWJ / ZWNJ stay: emoji sequences need them.)
 */
export const INVISIBLE_CHAR = /[\u0080-\u009F\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/;

/** True when the text has no control or invisible formatting characters. */
const is_printable = (s: string): boolean =>
  [...s].every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f && !INVISIBLE_CHAR.test(ch);
  });

/** Short, single-line device facts (D9). Printable text only, trimmed. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const short_text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(is_printable, "must be printable text");

export const submit_feedback_input_schema = z.object({
  note_id: z.string().regex(NOTE_ID_PATTERN, "note_id is malformed"),
  type: z.enum(FEEDBACK_TYPES),
  // Payload guard only: the D8 limit is checked AFTER cleanup (trim etc.) in the domain, so
  // trailing whitespace on a 5,000-character note is fine.
  message: z
    .string()
    .max(MAX_FEEDBACK_LENGTH * 2, `Notes can be up to ${MAX_FEEDBACK_LENGTH} characters`),
  app_version: short_text(32).pipe(z.string().min(1, "app_version is required")),
  build: short_text(16).pipe(z.string().min(1, "build is required")),
  screen: short_text(64).optional(),
  device: short_text(64).optional(),
  os_version: short_text(32).optional(),
});
export type SubmitFeedbackInput = z.infer<typeof submit_feedback_input_schema>;

export const feedback_inbox_input_schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    status: z.enum(["open", "done"]).default("open"),
    type: z.enum(FEEDBACK_TYPES).optional(),
  }),
  z.object({ action: z.literal("mark_read"), note_id: z.string().regex(NOTE_ID_PATTERN) }),
  z.object({
    action: z.literal("set_status"),
    note_id: z.string().regex(NOTE_ID_PATTERN),
    status: z.enum(["open", "done"]),
  }),
  z.object({ action: z.literal("delete"), note_id: z.string().regex(NOTE_ID_PATTERN) }),
]);
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
  reply: { message: string; replied_at_ms: number } | null;
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
  reply: { message: string; replied_at_ms: number } | null;
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

export type FeedbackInboxResult =
  | { action: "list"; notes: InboxFeedbackItem[]; truncated: boolean }
  | { action: "mark_read" | "set_status" | "delete"; note_id: string; changed: boolean };
