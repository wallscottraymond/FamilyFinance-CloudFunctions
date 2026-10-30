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
import { CreateIdeaInput, Idea, IdeaComment, IdeaFields, IdeaTargetKind } from "../../types/ideas.types";
/**
 * Text as stored: CRLF/CR → LF, control and invisible characters removed, trimmed. One-line
 * text (titles, topics, comments keep newlines) also collapses runs of whitespace.
 */
export declare function clean_text(raw: string, one_line: boolean): string;
/** A real calendar day in `YYYY-MM-DD` (rejects 2026-02-30). */
export declare function is_real_date(date: string): boolean;
/**
 * May `actor` use the list with this owner key? Me lists: only their person. Group lists: any
 * member of that (active) group.
 */
export declare function can_use_list(owner_key: string, actor_id: string, group: Group | null): boolean;
/**
 * A list's topics: names in display order + how many OPEN ideas use each. A topic nothing uses
 * any more drops out, so the cap counts only topics in use (a list can't lock up on old names).
 */
export interface IdeaTopics {
    names: string[];
    counts: Record<string, number>;
}
/** What an action does. `topics` null = the list's topics don't change. */
export type IdeaPlan<R> = {
    kind: "write";
    /** The idea to store, or null to delete it. */
    idea: Idea | null;
    topics: IdeaTopics | null;
    comment: {
        set: IdeaComment;
    } | {
        delete: string;
    } | null;
    result: R;
} | {
    kind: "noop";
    result: R;
} | {
    kind: "rejected";
    code: string;
    message: string;
};
/** A topic name: one line, trimmed; empty → none. */
export declare function clean_topic(raw: string | null | undefined): string | null | {
    error: string;
};
/** An existing topic (any case) is reused as spelled there; otherwise the new name. */
export declare function spelled_topic(topics: IdeaTopics, topic: string | null): string | null;
/**
 * The topics after one open idea stops using `from` and starts using `to` (either may be null).
 * New names go at the end; names no open idea uses drop out. Null = no change. Refuses a new
 * name past MAX_TOPICS.
 */
export declare function topics_after(topics: IdeaTopics, from: string | null, to: string | null): IdeaTopics | null | {
    error: string;
};
export interface CreateContext {
    owner_key: string;
    actor_id: string;
    now_ms: number;
    open_count: number;
}
/** A new idea (or nothing, when a retried create finds its own idea). */
export declare function plan_create(input: CreateIdeaInput, c: CreateContext, existing: Idea | null, topics: IdeaTopics): IdeaPlan<{
    idea_id: string;
    deduped: boolean;
}>;
/** Change some fields; a field left out stays, `null` clears it. */
export declare function plan_edit(idea: Idea, fields: IdeaFields, actor_id: string, now_ms: number, topics: IdeaTopics): IdeaPlan<{
    idea_id: string;
    status: "open" | "converted";
}>;
/**
 * The idea became a bill / budget / goal (D8/D12): it leaves the open list and is kept for
 * CONVERTED_RETENTION_MS (TTL) so it can still be restored. Repeating the same convert is a no-op.
 */
export declare function plan_convert(idea: Idea, target: {
    kind: IdeaTargetKind;
    id: string;
}, actor_id: string, now_ms: number, topics: IdeaTopics): IdeaPlan<{
    idea_id: string;
    status: "open" | "converted";
}>;
/** Put a converted idea back on the list (the made item is left alone). */
export declare function plan_restore(idea: Idea, actor_id: string, now_ms: number, topics: IdeaTopics, open_count: number): IdeaPlan<{
    idea_id: string;
    status: "open" | "converted";
}>;
export declare function plan_like(idea: Idea, actor_id: string, liked: boolean, now_ms: number): IdeaPlan<{
    idea_id: string;
    liked: boolean;
    comment_count: number;
}>;
/** A new comment (or nothing, when a retried send finds its own comment). */
export declare function plan_comment(idea: Idea, comment_id: string, raw_text: string, existing: IdeaComment | null, actor_id: string, now_ms: number): IdeaPlan<{
    idea_id: string;
    comment_id: string;
    comment_count: number;
}>;
/** Only a comment's author can delete it. A comment that's already gone is a no-op. */
export declare function plan_delete_comment(idea: Idea, comment_id: string, comment: IdeaComment | null, actor_id: string): IdeaPlan<{
    idea_id: string;
    comment_id: string;
    comment_count: number;
}>;
/** Delete the idea (its comments go with it, outside the transaction). */
export declare function plan_delete(idea_id: string, idea: Idea | null, topics: IdeaTopics): IdeaPlan<{
    idea_id: string;
    deleted: boolean;
}>;
//# sourceMappingURL=idea.service.d.ts.map