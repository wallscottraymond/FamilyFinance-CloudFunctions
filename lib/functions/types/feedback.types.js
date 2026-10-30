"use strict";
/**
 * Feedback-And-Questions — Zod input schemas, entities and response types.
 *
 * A note (`feedback/{noteId}`) NEVER carries who sent it: no uid, name or email (D2/D7). The
 * sender's own list lives in `feedback_senders/{uid}` (note ids + the daily counter), which only
 * functions read.
 *
 * @module types/feedback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedback_inbox_input_schema = exports.submit_feedback_input_schema = exports.INVISIBLE_CHAR = exports.STARTER_OPENINGS = exports.NOTE_ID_PATTERN = exports.FEEDBACK_INBOX_FLAG = exports.MAX_INBOX_NOTES = exports.MAX_SENDER_NOTE_IDS = exports.MAX_FEEDBACK_PER_DAY = exports.MAX_FEEDBACK_LENGTH = exports.FEEDBACK_TYPES = void 0;
const zod_1 = require("zod");
/** The six starters (D3): the chip the sender picked, saved as the note's type. */
exports.FEEDBACK_TYPES = ["idea", "howTo", "bug", "needThisToo", "question", "other"];
/** D8: longest note, in UTF-16 units (what the app's TextInput maxLength counts). */
exports.MAX_FEEDBACK_LENGTH = 5000;
/** D8: notes one person can send per UTC day. */
exports.MAX_FEEDBACK_PER_DAY = 20;
/** Bounds `feedback_senders.noteIds` (rule #9): the Sent tab shows the newest this many. */
exports.MAX_SENDER_NOTE_IDS = 200;
/** The owner inbox reads at most this many notes per status (newest first). */
exports.MAX_INBOX_NOTES = 300;
/** Owner allowlist for the inbox (`_feature_flags/feedback_inbox_v1`, enabled_user_ids ONLY). */
exports.FEEDBACK_INBOX_FLAG = "feedback_inbox_v1";
/** Client-made note id (dedupes a retried send): Firestore-safe, unguessable length. */
exports.NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/**
 * The starters' opening words (D4), trimmed — must match the app's `STARTERS[].prefill`. A note
 * that is only one of these says nothing, so the server refuses it like an empty note.
 */
exports.STARTER_OPENINGS = [
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
exports.INVISIBLE_CHAR = /[\u0080-\u009F\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/;
/** True when the text has no control or invisible formatting characters. */
const is_printable = (s) => [...s].every((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x20 && code !== 0x7f && !exports.INVISIBLE_CHAR.test(ch);
});
/** Short, single-line device facts (D9). Printable text only, trimmed. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const short_text = (max) => zod_1.z
    .string()
    .trim()
    .max(max)
    .refine(is_printable, "must be printable text");
exports.submit_feedback_input_schema = zod_1.z.object({
    note_id: zod_1.z.string().regex(exports.NOTE_ID_PATTERN, "note_id is malformed"),
    type: zod_1.z.enum(exports.FEEDBACK_TYPES),
    // Payload guard only: the D8 limit is checked AFTER cleanup (trim etc.) in the domain, so
    // trailing whitespace on a 5,000-character note is fine.
    message: zod_1.z
        .string()
        .max(exports.MAX_FEEDBACK_LENGTH * 2, `Notes can be up to ${exports.MAX_FEEDBACK_LENGTH} characters`),
    app_version: short_text(32).pipe(zod_1.z.string().min(1, "app_version is required")),
    build: short_text(16).pipe(zod_1.z.string().min(1, "build is required")),
    screen: short_text(64).optional(),
    device: short_text(64).optional(),
    os_version: short_text(32).optional(),
});
exports.feedback_inbox_input_schema = zod_1.z.discriminatedUnion("action", [
    zod_1.z.object({
        action: zod_1.z.literal("list"),
        status: zod_1.z.enum(["open", "done"]).default("open"),
        type: zod_1.z.enum(exports.FEEDBACK_TYPES).optional(),
    }),
    zod_1.z.object({ action: zod_1.z.literal("mark_read"), note_id: zod_1.z.string().regex(exports.NOTE_ID_PATTERN) }),
    zod_1.z.object({
        action: zod_1.z.literal("set_status"),
        note_id: zod_1.z.string().regex(exports.NOTE_ID_PATTERN),
        status: zod_1.z.enum(["open", "done"]),
    }),
    zod_1.z.object({ action: zod_1.z.literal("delete"), note_id: zod_1.z.string().regex(exports.NOTE_ID_PATTERN) }),
]);
//# sourceMappingURL=feedback.types.js.map