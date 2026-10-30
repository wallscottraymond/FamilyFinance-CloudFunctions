/**
 * Ideas Repository (Planning-Module v1)
 *
 * - `ideas/{ideaId}`: one idea. `userId` = the list's owner key (uid, or "group:<groupId>").
 * - `idea_comments/{commentId}`: one comment; `userId` repeats the idea's owner key so the
 *   rules can let the list's people read it.
 * - `idea_topics/{ownerKey}`: the list's topic names.
 *
 * Clients read all three directly (listeners); every write goes through these functions.
 *
 * @module repositories/idea
 */
import { TraceContext } from "../types";
import { IdeaPlan, IdeaTopics } from "../domain/ideas/idea.service";
import { Idea, IdeaComment } from "../types/ideas.types";
export declare const IDEAS_COLLECTION = "ideas";
export declare const IDEA_COMMENTS_COLLECTION = "idea_comments";
export declare const IDEA_TOPICS_COLLECTION = "idea_topics";
/** What one transaction reads: the idea, the list's topics, and (for comment actions) a comment. */
export interface IdeaSnapshot {
    idea: Idea | null;
    topics: IdeaTopics;
    comment: IdeaComment | null;
}
export declare const idea_repo: {
    get(_ctx: TraceContext, idea_id: string): Promise<Idea | null>;
    /** Open ideas in one list (aggregation: one read per 1,000). */
    count_open(_ctx: TraceContext, owner_key: string): Promise<number>;
    /**
     * One action, atomically: read the idea, the list's topics and (optionally) a comment; let the
     * (pure) plan decide; write the idea (or delete it), the topics and the comment together — or
     * nothing. Returns the plan.
     */
    apply_in_transaction<R>(_ctx: TraceContext, refs: {
        idea_id: string;
        owner_key: string;
        comment_id?: string;
    }, plan: (snap: IdeaSnapshot) => IdeaPlan<R>): Promise<IdeaPlan<R>>;
    /**
     * Stamp (or clear) the TTL on an idea's comments, so they leave with a converted idea and stay
     * when it's restored. Bounded by MAX_COMMENTS_PER_IDEA.
     */
    set_comments_expiry(_ctx: TraceContext, idea_id: string, owner_key: string, expire_at_ms: number | null): Promise<number>;
    /**
     * Delete a whole list: every idea and comment with this owner key and its topics doc (a group
     * that closed). Pages of DELETE_PAGE until nothing is left. Returns the docs deleted.
     */
    delete_list(_ctx: TraceContext, owner_key: string): Promise<number>;
    /** Delete every comment on an idea (bounded by MAX_COMMENTS_PER_IDEA). Returns the count. */
    delete_comments(_ctx: TraceContext, idea_id: string, owner_key: string): Promise<number>;
};
//# sourceMappingURL=idea.repo.d.ts.map