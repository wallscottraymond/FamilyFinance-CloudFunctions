/**
 * Ideas domain service (Planning-Module v1) — PURE: no IO, no clock, no logging.
 *
 * Decides what each idea action does (write / nothing to do / refused): cleans the text, keeps
 * every list bounded (topics, likes, comments, open ideas), and checks who may touch a list —
 * a Me list only its person, a group list any member of that group (D9: collaboration).
 *
 * @module domain/ideas/idea.service
 */

import { Group } from "../../types/sharing.types";
import { group_id_of_key } from "../sharing/budget_view.service";
import { is_member } from "../sharing/group.service";
import {
  CONVERTED_RETENTION_MS,
  CreateIdeaInput,
  Idea,
  IdeaComment,
  IdeaFields,
  IdeaKind,
  IdeaTargetKind,
  MAX_COMMENTS_PER_IDEA,
  MAX_COMMENT_LENGTH,
  MAX_IDEA_NOTES,
  MAX_IDEA_TITLE,
  MAX_LIKES,
  MAX_OPEN_IDEAS,
  MAX_TOPICS,
  MAX_TOPIC_NAME,
} from "../../types/ideas.types";

/** C1 controls, zero-width space, word joiner, BOM, bidi embeddings / overrides / isolates. */
const INVISIBLE_ALL = /[\u0080-\u009F\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

/**
 * Text as stored: CRLF/CR → LF, control and invisible characters removed, trimmed. One-line
 * text (titles, topics, comments keep newlines) also collapses runs of whitespace.
 */
export function clean_text(raw: string, one_line: boolean): string {
  let s = raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(INVISIBLE_ALL, "");
  if (one_line) s = s.replace(/\s+/g, " ");
  return s.trim();
}

/** A real calendar day in `YYYY-MM-DD` (rejects 2026-02-30). */
export function is_real_date(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * May `actor` use the list with this owner key? Me lists: only their person. Group lists: any
 * member of that (active) group.
 */
export function can_use_list(owner_key: string, actor_id: string, group: Group | null): boolean {
  const gid = group_id_of_key(owner_key);
  if (gid === null) return owner_key === actor_id;
  return !!group && group.id === gid && is_member(group, actor_id);
}

/**
 * A list's topics: names in display order + how many OPEN ideas use each. A topic nothing uses
 * any more drops out, so the cap counts only topics in use (a list can't lock up on old names).
 */
export interface IdeaTopics {
  names: string[];
  counts: Record<string, number>;
}

/** What an action does. `topics` null = the list's topics don't change. */
export type IdeaPlan<R> =
  | {
      kind: "write";
      /** The idea to store, or null to delete it. */
      idea: Idea | null;
      topics: IdeaTopics | null;
      comment: { set: IdeaComment } | { delete: string } | null;
      result: R;
    }
  | { kind: "noop"; result: R }
  | { kind: "rejected"; code: string; message: string };

type Rejected = { kind: "rejected"; code: string; message: string };
const reject = (code: string, message: string): Rejected => ({ kind: "rejected", code, message });

const NOT_OPEN = reject("FAILED_PRECONDITION", "This idea was already made into something.");

/** The cleaned title, or a refusal. Only the title is required (D6). */
function clean_title(raw: string): string | { error: string } {
  const title = clean_text(raw, true);
  if (!title) return { error: "Add a few words for the idea." };
  if (title.length > MAX_IDEA_TITLE) {
    return { error: `Ideas can be up to ${MAX_IDEA_TITLE} characters.` };
  }
  return title;
}

function clean_notes(raw: string): string | { error: string } {
  const notes = clean_text(raw, false);
  if (notes.length > MAX_IDEA_NOTES) {
    return { error: `Notes can be up to ${MAX_IDEA_NOTES} characters.` };
  }
  return notes;
}

/** A topic name: one line, trimmed; empty → none. */
export function clean_topic(raw: string | null | undefined): string | null | { error: string } {
  if (raw === null || raw === undefined) return null;
  const topic = clean_text(raw, true);
  if (!topic) return null;
  // Topic names are keys in the list's usage counts: Firestore reserves `__name__`-style keys.
  if (/^__.*__$/.test(topic)) return { error: "That topic name isn't allowed." };
  if (topic.length > MAX_TOPIC_NAME) {
    return { error: `Topics can be up to ${MAX_TOPIC_NAME} characters.` };
  }
  return topic;
}

/** An existing topic (any case) is reused as spelled there; otherwise the new name. */
export function spelled_topic(topics: IdeaTopics, topic: string | null): string | null {
  if (topic === null) return null;
  return topics.names.find((t) => t.toLowerCase() === topic.toLowerCase()) ?? topic;
}

/**
 * The topics after one open idea stops using `from` and starts using `to` (either may be null).
 * New names go at the end; names no open idea uses drop out. Null = no change. Refuses a new
 * name past MAX_TOPICS.
 */
export function topics_after(
  topics: IdeaTopics,
  from: string | null,
  to: string | null
): IdeaTopics | null | { error: string } {
  if (from === to) return null;
  const counts = { ...topics.counts };
  let names = [...topics.names];
  if (from !== null) counts[from] = (counts[from] ?? 0) - 1;
  if (to !== null) {
    if (!names.includes(to)) {
      if (names.filter((n) => (counts[n] ?? 0) > 0).length >= MAX_TOPICS) {
        return { error: `A list can have up to ${MAX_TOPICS} topics.` };
      }
      names.push(to);
    }
    counts[to] = (counts[to] ?? 0) + 1;
  }
  names = names.filter((n) => (counts[n] ?? 0) > 0);
  const kept: Record<string, number> = {};
  names.forEach((n) => (kept[n] = counts[n]));
  return { names, counts: kept };
}

function check_date(date: string | null | undefined): { error: string } | null {
  if (date && !is_real_date(date)) return { error: "That date doesn't exist." };
  return null;
}

const is_error = (v: unknown): v is { error: string } =>
  typeof v === "object" && v !== null && "error" in v;

export interface CreateContext {
  owner_key: string;
  actor_id: string;
  now_ms: number;
  open_count: number;
}

/** A new idea (or nothing, when a retried create finds its own idea). */
export function plan_create(
  input: CreateIdeaInput,
  c: CreateContext,
  existing: Idea | null,
  topics: IdeaTopics
): IdeaPlan<{ idea_id: string; deduped: boolean }> {
  if (existing) {
    if (existing.owner_key === c.owner_key && existing.created_by === c.actor_id) {
      return { kind: "noop", result: { idea_id: existing.id, deduped: true } };
    }
    return reject("ALREADY_EXISTS", "Couldn't save the idea. Please try again.");
  }
  if (c.open_count >= MAX_OPEN_IDEAS) {
    return reject("RESOURCE_EXHAUSTED", `A list can hold up to ${MAX_OPEN_IDEAS} ideas.`);
  }
  const title = clean_title(input.title);
  if (is_error(title)) return reject("VALIDATION_ERROR", title.error);
  const notes = clean_notes(input.notes ?? "");
  if (is_error(notes)) return reject("VALIDATION_ERROR", notes.error);
  const topic = clean_topic(input.topic);
  if (is_error(topic)) return reject("VALIDATION_ERROR", topic.error);
  const date_error = check_date(input.date);
  if (date_error) return reject("VALIDATION_ERROR", date_error.error);
  const spelled = spelled_topic(topics, topic);
  const topics_next = topics_after(topics, null, spelled);
  if (is_error(topics_next)) return reject("VALIDATION_ERROR", topics_next.error);

  const idea: Idea = {
    id: input.idea_id,
    owner_key: c.owner_key,
    created_by: c.actor_id,
    title,
    notes,
    kind: input.kind ?? "idea",
    topic: spelled,
    amount: input.amount ?? null,
    date: input.date ?? null,
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

const touched = (idea: Idea, actor_id: string, now_ms: number): Idea => ({
  ...idea,
  updated_at_ms: now_ms,
  updated_by: actor_id,
});

/** Change some fields; a field left out stays, `null` clears it. */
export function plan_edit(
  idea: Idea,
  fields: IdeaFields,
  actor_id: string,
  now_ms: number,
  topics: IdeaTopics
): IdeaPlan<{ idea_id: string; status: "open" | "converted" }> {
  if (idea.status !== "open") return NOT_OPEN;
  const next: Idea = { ...idea };
  let topics_next: IdeaTopics | null = null;

  if (fields.title !== undefined) {
    const title = clean_title(fields.title);
    if (is_error(title)) return reject("VALIDATION_ERROR", title.error);
    next.title = title;
  }
  if (fields.notes !== undefined) {
    const notes = clean_notes(fields.notes);
    if (is_error(notes)) return reject("VALIDATION_ERROR", notes.error);
    next.notes = notes;
  }
  if (fields.kind !== undefined) next.kind = fields.kind as IdeaKind;
  if (fields.topic !== undefined) {
    const topic = clean_topic(fields.topic);
    if (is_error(topic)) return reject("VALIDATION_ERROR", topic.error);
    next.topic = spelled_topic(topics, topic);
    const after = topics_after(topics, idea.topic, next.topic);
    if (is_error(after)) return reject("VALIDATION_ERROR", after.error);
    topics_next = after;
  }
  if (fields.amount !== undefined) next.amount = fields.amount;
  if (fields.date !== undefined) {
    const date_error = check_date(fields.date);
    if (date_error) return reject("VALIDATION_ERROR", date_error.error);
    next.date = fields.date;
  }

  const unchanged =
    next.title === idea.title &&
    next.notes === idea.notes &&
    next.kind === idea.kind &&
    next.topic === idea.topic &&
    next.amount === idea.amount &&
    next.date === idea.date;
  const result = { idea_id: idea.id, status: idea.status };
  if (unchanged && topics_next === null) return { kind: "noop", result };
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
export function plan_convert(
  idea: Idea,
  target: { kind: IdeaTargetKind; id: string },
  actor_id: string,
  now_ms: number,
  topics: IdeaTopics
): IdeaPlan<{ idea_id: string; status: "open" | "converted" }> {
  const result = { idea_id: idea.id, status: "converted" as const };
  if (idea.status === "converted") {
    const same = idea.converted_to?.kind === target.kind && idea.converted_to?.id === target.id;
    return same ? { kind: "noop", result } : NOT_OPEN;
  }
  const next: Idea = {
    ...touched(idea, actor_id, now_ms),
    status: "converted",
    converted_to: { kind: target.kind, id: target.id },
    expire_at_ms: now_ms + CONVERTED_RETENTION_MS,
  };
  const topics_next = topics_after(topics, idea.topic, null);
  const t = is_error(topics_next) ? null : topics_next;
  return { kind: "write", idea: next, topics: t, comment: null, result };
}

/** Put a converted idea back on the list (the made item is left alone). */
export function plan_restore(
  idea: Idea,
  actor_id: string,
  now_ms: number,
  topics: IdeaTopics,
  open_count: number
): IdeaPlan<{ idea_id: string; status: "open" | "converted" }> {
  const result = { idea_id: idea.id, status: "open" as const };
  if (idea.status === "open") return { kind: "noop", result };
  if (open_count >= MAX_OPEN_IDEAS) {
    return reject("RESOURCE_EXHAUSTED", `A list can hold up to ${MAX_OPEN_IDEAS} ideas.`);
  }
  // The topic may have dropped out while the idea was away: it comes back (or the idea loses
  // it when the list is full of topics).
  const back = topics_after(topics, null, idea.topic);
  const next: Idea = {
    ...touched(idea, actor_id, now_ms),
    status: "open",
    converted_to: null,
    expire_at_ms: null,
    topic: is_error(back) ? null : idea.topic,
  };
  return { kind: "write", idea: next, topics: is_error(back) ? null : back, comment: null, result };
}

export function plan_like(
  idea: Idea,
  actor_id: string,
  liked: boolean,
  now_ms: number
): IdeaPlan<{ idea_id: string; liked: boolean; comment_count: number }> {
  const result = { idea_id: idea.id, liked, comment_count: idea.comment_count };
  const has = idea.liked_by.includes(actor_id);
  if (has === liked) return { kind: "noop", result };
  let liked_by: string[];
  if (liked) {
    if (idea.liked_by.length >= MAX_LIKES) return reject("RESOURCE_EXHAUSTED", "Too many likes.");
    liked_by = [...idea.liked_by, actor_id];
  } else {
    liked_by = idea.liked_by.filter((id) => id !== actor_id);
  }
  return {
    kind: "write",
    idea: { ...touched(idea, actor_id, now_ms), liked_by },
    topics: null,
    comment: null,
    result,
  };
}

/** A new comment (or nothing, when a retried send finds its own comment). */
export function plan_comment(
  idea: Idea,
  comment_id: string,
  raw_text: string,
  existing: IdeaComment | null,
  actor_id: string,
  now_ms: number
): IdeaPlan<{ idea_id: string; comment_id: string; comment_count: number }> {
  if (existing) {
    if (existing.idea_id === idea.id && existing.author_id === actor_id) {
      const result = { idea_id: idea.id, comment_id, comment_count: idea.comment_count };
      return { kind: "noop", result };
    }
    return reject("ALREADY_EXISTS", "Couldn't post. Please try again.");
  }
  if (idea.status !== "open") return NOT_OPEN;
  const text = clean_text(raw_text, false);
  if (!text) return reject("VALIDATION_ERROR", "Write a comment first.");
  if (text.length > MAX_COMMENT_LENGTH) {
    return reject("VALIDATION_ERROR", `Comments can be up to ${MAX_COMMENT_LENGTH} characters.`);
  }
  if (idea.comment_count >= MAX_COMMENTS_PER_IDEA) {
    const max = MAX_COMMENTS_PER_IDEA;
    return reject("RESOURCE_EXHAUSTED", `An idea can have up to ${max} comments.`);
  }
  const comment: IdeaComment = {
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
    idea: { ...touched(idea, actor_id, now_ms), comment_count },
    topics: null,
    comment: { set: comment },
    result: { idea_id: idea.id, comment_id, comment_count },
  };
}

/** Only a comment's author can delete it. A comment that's already gone is a no-op. */
export function plan_delete_comment(
  idea: Idea,
  comment_id: string,
  comment: IdeaComment | null,
  actor_id: string
): IdeaPlan<{ idea_id: string; comment_id: string; comment_count: number }> {
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
    idea: { ...idea, comment_count },
    topics: null,
    comment: { delete: comment.id },
    result: { idea_id: idea.id, comment_id: comment.id, comment_count },
  };
}

/** Delete the idea (its comments go with it, outside the transaction). */
export function plan_delete(
  idea_id: string,
  idea: Idea | null,
  topics: IdeaTopics
): IdeaPlan<{ idea_id: string; deleted: boolean }> {
  if (!idea) return { kind: "noop", result: { idea_id, deleted: false } };
  const result = { idea_id: idea.id, deleted: true };
  const after = idea.status === "open" ? topics_after(topics, idea.topic, null) : null;
  const t = after && !is_error(after) ? after : null;
  return { kind: "write", idea: null, topics: t, comment: null, result };
}
