"use strict";
/**
 * Ideas domain service (Planning-Module v1) — PURE: no IO, no clock, no logging.
 *
 * Decides what each idea action does (write / nothing to do / refused): cleans the text, keeps
 * every list bounded (topics, likes, comments, open ideas), and checks who may touch a list —
 * a Me list only its person, a group list any member of that group (D9: collaboration).
 *
 * @module domain/ideas/idea.service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clean_text = clean_text;
exports.is_real_date = is_real_date;
exports.can_use_list = can_use_list;
exports.clean_topic = clean_topic;
exports.spelled_topic = spelled_topic;
exports.topics_after = topics_after;
exports.plan_create = plan_create;
exports.plan_edit = plan_edit;
exports.plan_convert = plan_convert;
exports.plan_restore = plan_restore;
exports.plan_like = plan_like;
exports.plan_comment = plan_comment;
exports.plan_delete_comment = plan_delete_comment;
exports.plan_delete = plan_delete;
const budget_view_service_1 = require("../sharing/budget_view.service");
const group_service_1 = require("../sharing/group.service");
const ideas_types_1 = require("../../types/ideas.types");
/** C1 controls, zero-width space, word joiner, BOM, bidi embeddings / overrides / isolates. */
const INVISIBLE_ALL = /[\u0080-\u009F\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
/**
 * Text as stored: CRLF/CR → LF, control and invisible characters removed, trimmed. One-line
 * text (titles, topics, comments keep newlines) also collapses runs of whitespace.
 */
function clean_text(raw, one_line) {
    let s = raw
        .replace(/\r\n?/g, "\n")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(INVISIBLE_ALL, "");
    if (one_line)
        s = s.replace(/\s+/g, " ");
    return s.trim();
}
/** A real calendar day in `YYYY-MM-DD` (rejects 2026-02-30). */
function is_real_date(date) {
    const [y, m, d] = date.split("-").map(Number);
    if (!y || !m || !d)
        return false;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
/**
 * May `actor` use the list with this owner key? Me lists: only their person. Group lists: any
 * member of that (active) group.
 */
function can_use_list(owner_key, actor_id, group) {
    const gid = (0, budget_view_service_1.group_id_of_key)(owner_key);
    if (gid === null)
        return owner_key === actor_id;
    return !!group && group.id === gid && (0, group_service_1.is_member)(group, actor_id);
}
const reject = (code, message) => ({ kind: "rejected", code, message });
const NOT_OPEN = reject("FAILED_PRECONDITION", "This idea was already made into something.");
/** The cleaned title, or a refusal. Only the title is required (D6). */
function clean_title(raw) {
    const title = clean_text(raw, true);
    if (!title)
        return { error: "Add a few words for the idea." };
    if (title.length > ideas_types_1.MAX_IDEA_TITLE) {
        return { error: `Ideas can be up to ${ideas_types_1.MAX_IDEA_TITLE} characters.` };
    }
    return title;
}
function clean_notes(raw) {
    const notes = clean_text(raw, false);
    if (notes.length > ideas_types_1.MAX_IDEA_NOTES) {
        return { error: `Notes can be up to ${ideas_types_1.MAX_IDEA_NOTES} characters.` };
    }
    return notes;
}
/** A topic name: one line, trimmed; empty → none. */
function clean_topic(raw) {
    if (raw === null || raw === undefined)
        return null;
    const topic = clean_text(raw, true);
    if (!topic)
        return null;
    // Topic names are keys in the list's usage counts: Firestore reserves `__name__`-style keys.
    if (/^__.*__$/.test(topic))
        return { error: "That topic name isn't allowed." };
    if (topic.length > ideas_types_1.MAX_TOPIC_NAME) {
        return { error: `Topics can be up to ${ideas_types_1.MAX_TOPIC_NAME} characters.` };
    }
    return topic;
}
/** An existing topic (any case) is reused as spelled there; otherwise the new name. */
function spelled_topic(topics, topic) {
    var _a;
    if (topic === null)
        return null;
    return (_a = topics.names.find((t) => t.toLowerCase() === topic.toLowerCase())) !== null && _a !== void 0 ? _a : topic;
}
/**
 * The topics after one open idea stops using `from` and starts using `to` (either may be null).
 * New names go at the end; names no open idea uses drop out. Null = no change. Refuses a new
 * name past MAX_TOPICS.
 */
function topics_after(topics, from, to) {
    var _a, _b;
    if (from === to)
        return null;
    const counts = Object.assign({}, topics.counts);
    let names = [...topics.names];
    if (from !== null)
        counts[from] = ((_a = counts[from]) !== null && _a !== void 0 ? _a : 0) - 1;
    if (to !== null) {
        if (!names.includes(to)) {
            if (names.filter((n) => { var _a; return ((_a = counts[n]) !== null && _a !== void 0 ? _a : 0) > 0; }).length >= ideas_types_1.MAX_TOPICS) {
                return { error: `A list can have up to ${ideas_types_1.MAX_TOPICS} topics.` };
            }
            names.push(to);
        }
        counts[to] = ((_b = counts[to]) !== null && _b !== void 0 ? _b : 0) + 1;
    }
    names = names.filter((n) => { var _a; return ((_a = counts[n]) !== null && _a !== void 0 ? _a : 0) > 0; });
    const kept = {};
    names.forEach((n) => (kept[n] = counts[n]));
    return { names, counts: kept };
}
function check_date(date) {
    if (date && !is_real_date(date))
        return { error: "That date doesn't exist." };
    return null;
}
const is_error = (v) => typeof v === "object" && v !== null && "error" in v;
/** A new idea (or nothing, when a retried create finds its own idea). */
function plan_create(input, c, existing, topics) {
    var _a, _b, _c, _d;
    if (existing) {
        if (existing.owner_key === c.owner_key && existing.created_by === c.actor_id) {
            return { kind: "noop", result: { idea_id: existing.id, deduped: true } };
        }
        return reject("ALREADY_EXISTS", "Couldn't save the idea. Please try again.");
    }
    if (c.open_count >= ideas_types_1.MAX_OPEN_IDEAS) {
        return reject("RESOURCE_EXHAUSTED", `A list can hold up to ${ideas_types_1.MAX_OPEN_IDEAS} ideas.`);
    }
    const title = clean_title(input.title);
    if (is_error(title))
        return reject("VALIDATION_ERROR", title.error);
    const notes = clean_notes((_a = input.notes) !== null && _a !== void 0 ? _a : "");
    if (is_error(notes))
        return reject("VALIDATION_ERROR", notes.error);
    const topic = clean_topic(input.topic);
    if (is_error(topic))
        return reject("VALIDATION_ERROR", topic.error);
    const date_error = check_date(input.date);
    if (date_error)
        return reject("VALIDATION_ERROR", date_error.error);
    const spelled = spelled_topic(topics, topic);
    const topics_next = topics_after(topics, null, spelled);
    if (is_error(topics_next))
        return reject("VALIDATION_ERROR", topics_next.error);
    const idea = {
        id: input.idea_id,
        owner_key: c.owner_key,
        created_by: c.actor_id,
        title,
        notes,
        kind: (_b = input.kind) !== null && _b !== void 0 ? _b : "idea",
        topic: spelled,
        amount: (_c = input.amount) !== null && _c !== void 0 ? _c : null,
        date: (_d = input.date) !== null && _d !== void 0 ? _d : null,
        liked_by: [],
        comment_count: 0,
        status: "open",
        converted_to: null,
        created_at_ms: c.now_ms,
        updated_at_ms: c.now_ms,
        updated_by: c.actor_id,
        expire_at_ms: null,
    };
    return {
        kind: "write",
        idea,
        topics: topics_next,
        comment: null,
        result: { idea_id: idea.id, deduped: false },
    };
}
const touched = (idea, actor_id, now_ms) => (Object.assign(Object.assign({}, idea), { updated_at_ms: now_ms, updated_by: actor_id }));
/** Change some fields; a field left out stays, `null` clears it. */
function plan_edit(idea, fields, actor_id, now_ms, topics) {
    if (idea.status !== "open")
        return NOT_OPEN;
    const next = Object.assign({}, idea);
    let topics_next = null;
    if (fields.title !== undefined) {
        const title = clean_title(fields.title);
        if (is_error(title))
            return reject("VALIDATION_ERROR", title.error);
        next.title = title;
    }
    if (fields.notes !== undefined) {
        const notes = clean_notes(fields.notes);
        if (is_error(notes))
            return reject("VALIDATION_ERROR", notes.error);
        next.notes = notes;
    }
    if (fields.kind !== undefined)
        next.kind = fields.kind;
    if (fields.topic !== undefined) {
        const topic = clean_topic(fields.topic);
        if (is_error(topic))
            return reject("VALIDATION_ERROR", topic.error);
        next.topic = spelled_topic(topics, topic);
        const after = topics_after(topics, idea.topic, next.topic);
        if (is_error(after))
            return reject("VALIDATION_ERROR", after.error);
        topics_next = after;
    }
    if (fields.amount !== undefined)
        next.amount = fields.amount;
    if (fields.date !== undefined) {
        const date_error = check_date(fields.date);
        if (date_error)
            return reject("VALIDATION_ERROR", date_error.error);
        next.date = fields.date;
    }
    const unchanged = next.title === idea.title &&
        next.notes === idea.notes &&
        next.kind === idea.kind &&
        next.topic === idea.topic &&
        next.amount === idea.amount &&
        next.date === idea.date;
    const result = { idea_id: idea.id, status: idea.status };
    if (unchanged && topics_next === null)
        return { kind: "noop", result };
    return {
        kind: "write",
        idea: touched(next, actor_id, now_ms),
        topics: topics_next,
        comment: null,
        result,
    };
}
/**
 * The idea became a bill / budget / goal (D8/D12): it leaves the open list and is kept for
 * CONVERTED_RETENTION_MS (TTL) so it can still be restored. Repeating the same convert is a no-op.
 */
function plan_convert(idea, target, actor_id, now_ms, topics) {
    var _a, _b;
    const result = { idea_id: idea.id, status: "converted" };
    if (idea.status === "converted") {
        const same = ((_a = idea.converted_to) === null || _a === void 0 ? void 0 : _a.kind) === target.kind && ((_b = idea.converted_to) === null || _b === void 0 ? void 0 : _b.id) === target.id;
        return same ? { kind: "noop", result } : NOT_OPEN;
    }
    const next = Object.assign(Object.assign({}, touched(idea, actor_id, now_ms)), { status: "converted", converted_to: { kind: target.kind, id: target.id }, expire_at_ms: now_ms + ideas_types_1.CONVERTED_RETENTION_MS });
    const topics_next = topics_after(topics, idea.topic, null);
    const t = is_error(topics_next) ? null : topics_next;
    return { kind: "write", idea: next, topics: t, comment: null, result };
}
/** Put a converted idea back on the list (the made item is left alone). */
function plan_restore(idea, actor_id, now_ms, topics, open_count) {
    const result = { idea_id: idea.id, status: "open" };
    if (idea.status === "open")
        return { kind: "noop", result };
    if (open_count >= ideas_types_1.MAX_OPEN_IDEAS) {
        return reject("RESOURCE_EXHAUSTED", `A list can hold up to ${ideas_types_1.MAX_OPEN_IDEAS} ideas.`);
    }
    // The topic may have dropped out while the idea was away: it comes back (or the idea loses
    // it when the list is full of topics).
    const back = topics_after(topics, null, idea.topic);
    const next = Object.assign(Object.assign({}, touched(idea, actor_id, now_ms)), { status: "open", converted_to: null, expire_at_ms: null, topic: is_error(back) ? null : idea.topic });
    return { kind: "write", idea: next, topics: is_error(back) ? null : back, comment: null, result };
}
function plan_like(idea, actor_id, liked, now_ms) {
    const result = { idea_id: idea.id, liked, comment_count: idea.comment_count };
    const has = idea.liked_by.includes(actor_id);
    if (has === liked)
        return { kind: "noop", result };
    let liked_by;
    if (liked) {
        if (idea.liked_by.length >= ideas_types_1.MAX_LIKES)
            return reject("RESOURCE_EXHAUSTED", "Too many likes.");
        liked_by = [...idea.liked_by, actor_id];
    }
    else {
        liked_by = idea.liked_by.filter((id) => id !== actor_id);
    }
    return {
        kind: "write",
        idea: Object.assign(Object.assign({}, touched(idea, actor_id, now_ms)), { liked_by }),
        topics: null,
        comment: null,
        result,
    };
}
/** A new comment (or nothing, when a retried send finds its own comment). */
function plan_comment(idea, comment_id, raw_text, existing, actor_id, now_ms) {
    if (existing) {
        if (existing.idea_id === idea.id && existing.author_id === actor_id) {
            const result = { idea_id: idea.id, comment_id, comment_count: idea.comment_count };
            return { kind: "noop", result };
        }
        return reject("ALREADY_EXISTS", "Couldn't post. Please try again.");
    }
    if (idea.status !== "open")
        return NOT_OPEN;
    const text = clean_text(raw_text, false);
    if (!text)
        return reject("VALIDATION_ERROR", "Write a comment first.");
    if (text.length > ideas_types_1.MAX_COMMENT_LENGTH) {
        return reject("VALIDATION_ERROR", `Comments can be up to ${ideas_types_1.MAX_COMMENT_LENGTH} characters.`);
    }
    if (idea.comment_count >= ideas_types_1.MAX_COMMENTS_PER_IDEA) {
        const max = ideas_types_1.MAX_COMMENTS_PER_IDEA;
        return reject("RESOURCE_EXHAUSTED", `An idea can have up to ${max} comments.`);
    }
    const comment = {
        id: comment_id,
        idea_id: idea.id,
        owner_key: idea.owner_key,
        author_id: actor_id,
        text,
        created_at_ms: now_ms,
    };
    const comment_count = idea.comment_count + 1;
    return {
        kind: "write",
        idea: Object.assign(Object.assign({}, touched(idea, actor_id, now_ms)), { comment_count }),
        topics: null,
        comment: { set: comment },
        result: { idea_id: idea.id, comment_id, comment_count },
    };
}
/** Only a comment's author can delete it. A comment that's already gone is a no-op. */
function plan_delete_comment(idea, comment_id, comment, actor_id) {
    if (!comment || comment.idea_id !== idea.id) {
        const result = { idea_id: idea.id, comment_id, comment_count: idea.comment_count };
        return { kind: "noop", result };
    }
    if (comment.author_id !== actor_id) {
        return reject("PERMISSION_DENIED", "Only the person who wrote a comment can delete it.");
    }
    const comment_count = Math.max(0, idea.comment_count - 1);
    return {
        kind: "write",
        idea: Object.assign(Object.assign({}, idea), { comment_count }),
        topics: null,
        comment: { delete: comment.id },
        result: { idea_id: idea.id, comment_id: comment.id, comment_count },
    };
}
/** Delete the idea (its comments go with it, outside the transaction). */
function plan_delete(idea_id, idea, topics) {
    if (!idea)
        return { kind: "noop", result: { idea_id, deleted: false } };
    const result = { idea_id: idea.id, deleted: true };
    const after = idea.status === "open" ? topics_after(topics, idea.topic, null) : null;
    const t = after && !is_error(after) ? after : null;
    return { kind: "write", idea: null, topics: t, comment: null, result };
}
//# sourceMappingURL=idea.service.js.map