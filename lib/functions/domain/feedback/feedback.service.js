"use strict";
/**
 * Feedback domain service (Feedback-And-Questions) — PURE: no IO, no clock, no logging.
 *
 * Decides what a send does (write / already sent / refused), builds the stored note (never a
 * sender), keeps the sender's list bounded, and maps notes to what the sender and the owner see.
 *
 * @module domain/feedback/feedback.service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.utc_day = utc_day;
exports.normalize_message = normalize_message;
exports.is_bare_starter = is_bare_starter;
exports.sent_today = sent_today;
exports.plan_submit = plan_submit;
exports.next_sender = next_sender;
exports.without_note = without_note;
exports.after_owner_delete = after_owner_delete;
exports.to_my_items = to_my_items;
exports.to_inbox_item = to_inbox_item;
exports.is_inbox_owner = is_inbox_owner;
const feedback_types_1 = require("../../types/feedback.types");
/** UTC calendar day (`YYYY-MM-DD`) of an instant — the daily limit's day. */
function utc_day(now_ms) {
    return new Date(now_ms).toISOString().slice(0, 10);
}
const INVISIBLE_ALL = new RegExp(feedback_types_1.INVISIBLE_CHAR.source, "g");
/**
 * The note text as stored: CRLF/CR → LF, every control character except newline and tab removed,
 * invisible formatting characters removed, surrounding whitespace trimmed. Null when nothing
 * visible is left (whitespace / ZWJ / ZWNJ alone count as nothing).
 */
function normalize_message(message) {
    const cleaned = message
        .replace(/\r\n?/g, "\n")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(INVISIBLE_ALL, "")
        .trim();
    return cleaned.replace(/[\s\u200C\u200D]/g, "").length > 0 ? cleaned : null;
}
/** True when the note is only a starter's opening words (D4) — nothing written yet. */
function is_bare_starter(message) {
    return feedback_types_1.STARTER_OPENINGS.includes(message.trim());
}
/** Optional device facts: blank → null (never an empty string in the store). */
function optional_text(value) {
    const v = value === null || value === void 0 ? void 0 : value.trim();
    return v ? v : null;
}
/** Notes already counted today (a counter from an earlier day counts as 0). */
function sent_today(sender, day) {
    if (!sender || sender.daily_date !== day)
        return 0;
    return Math.max(0, sender.daily_count);
}
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
function plan_submit(input, sender, note_exists, now_ms) {
    const day = utc_day(now_ms);
    const count = sent_today(sender, day);
    // The owner deleted this note and a late retry arrived: still "sent", never re-created.
    if (!note_exists && (sender === null || sender === void 0 ? void 0 : sender.retired_note_ids.includes(input.note_id))) {
        return { kind: "deduped", remaining_today: Math.max(0, feedback_types_1.MAX_FEEDBACK_PER_DAY - count) };
    }
    if (note_exists) {
        if (sender === null || sender === void 0 ? void 0 : sender.note_ids.includes(input.note_id)) {
            return { kind: "deduped", remaining_today: Math.max(0, feedback_types_1.MAX_FEEDBACK_PER_DAY - count) };
        }
        return {
            kind: "rejected",
            code: "ID_TAKEN",
            message: "That note couldn't be sent. Please try again.",
        };
    }
    const message = normalize_message(input.message);
    if (!message || is_bare_starter(message)) {
        return { kind: "rejected", code: "EMPTY", message: "Write a note before sending." };
    }
    if (message.length > feedback_types_1.MAX_FEEDBACK_LENGTH) {
        return {
            kind: "rejected",
            code: "TOO_LONG",
            message: `Notes can be up to ${feedback_types_1.MAX_FEEDBACK_LENGTH} characters.`,
        };
    }
    if (count >= feedback_types_1.MAX_FEEDBACK_PER_DAY) {
        return {
            kind: "rejected",
            code: "DAILY_LIMIT",
            message: "You've sent a lot today — try again tomorrow.",
        };
    }
    const note = {
        id: input.note_id,
        type: input.type,
        message,
        app_version: input.app_version.trim(),
        build: input.build.trim(),
        screen: optional_text(input.screen),
        device: optional_text(input.device),
        os_version: optional_text(input.os_version),
        created_at_ms: now_ms,
        status: "open",
        read_by_owner: false,
        reply: null,
    };
    return {
        kind: "write",
        note,
        sender: next_sender(sender, input.note_id, day),
        remaining_today: feedback_types_1.MAX_FEEDBACK_PER_DAY - (count + 1),
    };
}
/** The sender record after one more note: newest id first, no duplicates, bounded (rule #9). */
function next_sender(sender, note_id, day) {
    var _a, _b;
    const ids = [note_id, ...((_a = sender === null || sender === void 0 ? void 0 : sender.note_ids) !== null && _a !== void 0 ? _a : []).filter((id) => id !== note_id)];
    return {
        note_ids: ids.slice(0, feedback_types_1.MAX_SENDER_NOTE_IDS),
        daily_count: sent_today(sender, day) + 1,
        daily_date: day,
        retired_note_ids: (_b = sender === null || sender === void 0 ? void 0 : sender.retired_note_ids) !== null && _b !== void 0 ? _b : [],
    };
}
/** The sender's id list without one note (the owner deleted it). */
function without_note(note_ids, note_id) {
    return note_ids.filter((id) => id !== note_id);
}
/** The sender record after the owner deletes one of their notes: off the list, id retired. */
function after_owner_delete(sender, note_id) {
    return Object.assign(Object.assign({}, sender), { note_ids: without_note(sender.note_ids, note_id), retired_note_ids: [note_id, ...without_note(sender.retired_note_ids, note_id)].slice(0, feedback_types_1.MAX_SENDER_NOTE_IDS) });
}
/** Sent tab: the sender's notes in their list order (newest first); deleted notes drop out. */
function to_my_items(note_ids, notes) {
    const by_id = new Map(notes.map((n) => [n.id, n]));
    const items = [];
    for (const id of note_ids) {
        const note = by_id.get(id);
        if (!note)
            continue;
        items.push({
            id: note.id,
            type: note.type,
            message: note.message,
            created_at_ms: note.created_at_ms,
            reply: note.reply,
        });
    }
    return items;
}
/** Inbox: exactly the stored note fields. There is no sender to leak — the note has none. */
function to_inbox_item(note) {
    return {
        id: note.id,
        type: note.type,
        message: note.message,
        app_version: note.app_version,
        build: note.build,
        screen: note.screen,
        device: note.device,
        os_version: note.os_version,
        created_at_ms: note.created_at_ms,
        status: note.status,
        read_by_owner: note.read_by_owner,
        reply: note.reply,
    };
}
/**
 * Is this user an inbox owner? ONLY an explicit allowlist entry on an enabled flag counts —
 * `rollout_percentage` and group ids are ignored on purpose, so a mistaken rollout can never open
 * every sender's notes to everyone.
 */
function is_inbox_owner(flag, user_id) {
    if (!flag || flag.enabled !== true || !user_id)
        return false;
    return Array.isArray(flag.enabled_user_ids) && flag.enabled_user_ids.includes(user_id);
}
//# sourceMappingURL=feedback.service.js.map