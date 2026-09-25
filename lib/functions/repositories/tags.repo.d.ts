/**
 * Tags Repository — the user's tag catalog (`tags` collection).
 *
 * Top-level fields are camelCase (`userId`); one small doc per tag. The catalog loads once
 * (single-field `userId` query, no composite index) and is sorted in memory.
 *
 * @module repositories/tags
 */
import { TraceContext } from "../types";
import { Tag } from "../types/tags.types";
type TagWriteFields = {
    name: string;
    color: string;
};
export declare const tags_repo: {
    /** All of a user's tags, name-sorted. */
    list_tags(_ctx: TraceContext, user_id: string): Promise<Tag[]>;
    /** Count a user's tags (for the cap). */
    count_tags(_ctx: TraceContext, user_id: string): Promise<number>;
    /** Create a tag; returns the new id. */
    create_tag(_ctx: TraceContext, user_id: string, fields: TagWriteFields): Promise<string>;
    /** Load one tag (ownership checked by the caller). */
    get_tag(_ctx: TraceContext, tag_id: string): Promise<Tag | null>;
    /** Patch a tag's editable fields (name/color). */
    update_tag(_ctx: TraceContext, tag_id: string, patch: Partial<TagWriteFields>): Promise<void>;
    /** Delete the catalog doc. (Stripping the id off tagged docs/rules is added in later phases,
     *  once `tagIds`/budget tags/rule-tag refs exist to strip.) */
    delete_tag(_ctx: TraceContext, tag_id: string): Promise<void>;
};
export {};
//# sourceMappingURL=tags.repo.d.ts.map