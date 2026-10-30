/**
 * Ideas (Planning-Module v1, D11) — Zod input schemas, entities and response types.
 *
 * An idea lives in one list: a person's own (Me, `userId` = uid) or a group's (Household,
 * `userId` = "group:<groupId>", the same owner key as group budgets). Any member of the group can
 * change a group idea; only a comment's author can delete it. Only the title is required (D6).
 *
 * - `ideas/{ideaId}`: the idea (client-made id, so a retried create can't make two).
 * - `idea_comments/{commentId}`: one comment; carries the idea's owner key for the rules.
 * - `idea_topics/{ownerKey}`: the list's topic names (D13).
 *
 * @module types/ideas
 */
import { z } from "zod";
/** What the person says the idea is (D7: picked, never guessed). */
export declare const IDEA_KINDS: readonly ["idea", "bill", "budget", "goal"];
export type IdeaKind = (typeof IDEA_KINDS)[number];
/** What an idea can become (D5). */
export declare const IDEA_TARGET_KINDS: readonly ["bill", "budget", "goal"];
export type IdeaTargetKind = (typeof IDEA_TARGET_KINDS)[number];
export declare const MAX_IDEA_TITLE = 120;
export declare const MAX_IDEA_NOTES = 2000;
export declare const MAX_TOPIC_NAME = 40;
export declare const MAX_COMMENT_LENGTH = 1000;
/** Bounds (rule #9): topics per list, comments per idea, likes per idea (= group size cap). */
export declare const MAX_TOPICS = 30;
export declare const MAX_COMMENTS_PER_IDEA = 200;
export declare const MAX_LIKES = 50;
/** Open ideas one list may hold (the app's listener reads at most this many). */
export declare const MAX_OPEN_IDEAS = 500;
/** A converted idea is kept this long (TTL on `expireAt`), then Firestore removes it. */
export declare const CONVERTED_RETENTION_MS: number;
export declare const MAX_IDEA_AMOUNT = 10000000;
/** Owner allowlist / rollout for the whole feature (`_feature_flags/ideas_v1`). */
export declare const IDEAS_FLAG = "ideas_v1";
/** Client-made ids (idea, comment): Firestore-safe, unguessable length. */
export declare const IDEA_ID_PATTERN: RegExp;
export declare const IDEA_DATE_PATTERN: RegExp;
export declare const create_idea_input_schema: z.ZodObject<{
    idea_id: z.ZodString;
    view_group_id: z.ZodOptional<z.ZodString>;
    title: z.ZodString;
    notes: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        budget: "budget";
        goal: "goal";
        idea: "idea";
        bill: "bill";
    }>>;
    topic: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export type CreateIdeaInput = z.infer<typeof create_idea_input_schema>;
/** The editable fields; a field left out is unchanged, `null` clears it. */
export declare const idea_fields_schema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<{
        budget: "budget";
        goal: "goal";
        idea: "idea";
        bill: "bill";
    }>>;
    topic: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type IdeaFields = z.infer<typeof idea_fields_schema>;
export declare const update_idea_input_schema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"edit">;
    idea_id: z.ZodString;
    fields: z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<{
            budget: "budget";
            goal: "goal";
            idea: "idea";
            bill: "bill";
        }>>;
        topic: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"convert">;
    idea_id: z.ZodString;
    converted_to: z.ZodObject<{
        kind: z.ZodEnum<{
            budget: "budget";
            goal: "goal";
            bill: "bill";
        }>;
        id: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"restore">;
    idea_id: z.ZodString;
}, z.core.$strip>], "action">;
export type UpdateIdeaInput = z.infer<typeof update_idea_input_schema>;
export declare const delete_idea_input_schema: z.ZodObject<{
    idea_id: z.ZodString;
}, z.core.$strip>;
export type DeleteIdeaInput = z.infer<typeof delete_idea_input_schema>;
export declare const react_to_idea_input_schema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"like">;
    idea_id: z.ZodString;
    liked: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"comment">;
    idea_id: z.ZodString;
    comment_id: z.ZodString;
    text: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"delete_comment">;
    idea_id: z.ZodString;
    comment_id: z.ZodString;
}, z.core.$strip>], "action">;
export type ReactToIdeaInput = z.infer<typeof react_to_idea_input_schema>;
export type IdeaStatus = "open" | "converted";
/** A stored idea. */
export interface Idea {
    id: string;
    owner_key: string;
    created_by: string;
    title: string;
    notes: string;
    kind: IdeaKind;
    topic: string | null;
    amount: number | null;
    date: string | null;
    liked_by: string[];
    comment_count: number;
    status: IdeaStatus;
    converted_to: {
        kind: IdeaTargetKind;
        id: string;
    } | null;
    created_at_ms: number;
    updated_at_ms: number;
    updated_by: string;
    /** Set when converted (TTL removes it after CONVERTED_RETENTION_MS); null while open. */
    expire_at_ms: number | null;
}
export interface IdeaComment {
    id: string;
    idea_id: string;
    owner_key: string;
    author_id: string;
    text: string;
    created_at_ms: number;
}
export interface CreateIdeaResult {
    idea_id: string;
    deduped: boolean;
}
export interface UpdateIdeaResult {
    idea_id: string;
    status: IdeaStatus;
}
export interface DeleteIdeaResult {
    idea_id: string;
    deleted: boolean;
}
export interface ReactToIdeaResult {
    idea_id: string;
    liked?: boolean;
    comment_id?: string;
    comment_count: number;
}
//# sourceMappingURL=ideas.types.d.ts.map