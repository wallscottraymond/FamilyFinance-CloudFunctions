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
export const IDEA_KINDS = ["idea", "bill", "budget", "goal"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** What an idea can become (D5). */
export const IDEA_TARGET_KINDS = ["bill", "budget", "goal"] as const;
export type IdeaTargetKind = (typeof IDEA_TARGET_KINDS)[number];

export const MAX_IDEA_TITLE = 120;
export const MAX_IDEA_NOTES = 2000;
export const MAX_TOPIC_NAME = 40;
export const MAX_COMMENT_LENGTH = 1000;
/** Bounds (rule #9): topics per list, comments per idea, likes per idea (= group size cap). */
export const MAX_TOPICS = 30;
export const MAX_COMMENTS_PER_IDEA = 200;
export const MAX_LIKES = 50;
/** Open ideas one list may hold (the app's listener reads at most this many). */
export const MAX_OPEN_IDEAS = 500;
/** A converted idea is kept this long (TTL on `expireAt`), then Firestore removes it. */
export const CONVERTED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_IDEA_AMOUNT = 10_000_000;

/** Owner allowlist / rollout for the whole feature (`_feature_flags/ideas_v1`). */
export const IDEAS_FLAG = "ideas_v1";

/** Client-made ids (idea, comment): Firestore-safe, unguessable length. */
export const IDEA_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const IDEA_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const id_schema = z.string().regex(IDEA_ID_PATTERN, "id is malformed");
const view_group_id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "view_group_id is malformed")
  .optional();
// Payload guards only: the real limits are checked after cleanup in the domain.
const title_schema = z.string().max(MAX_IDEA_TITLE * 2);
const notes_schema = z.string().max(MAX_IDEA_NOTES * 2);
const topic_schema = z.string().max(MAX_TOPIC_NAME * 2).nullable();
const amount_schema = z.number().finite().min(0).max(MAX_IDEA_AMOUNT).nullable();
const date_schema = z.string().regex(IDEA_DATE_PATTERN, "date must be YYYY-MM-DD").nullable();

export const create_idea_input_schema = z.object({
  idea_id: id_schema,
  view_group_id,
  title: title_schema,
  notes: notes_schema.optional(),
  kind: z.enum(IDEA_KINDS).optional(),
  topic: topic_schema.optional(),
  amount: amount_schema.optional(),
  date: date_schema.optional(),
});
export type CreateIdeaInput = z.infer<typeof create_idea_input_schema>;

/** The editable fields; a field left out is unchanged, `null` clears it. */
export const idea_fields_schema = z
  .object({
    title: title_schema.optional(),
    notes: notes_schema.optional(),
    kind: z.enum(IDEA_KINDS).optional(),
    topic: topic_schema.optional(),
    amount: amount_schema.optional(),
    date: date_schema.optional(),
  })
  .strict();
export type IdeaFields = z.infer<typeof idea_fields_schema>;

export const update_idea_input_schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), idea_id: id_schema, fields: idea_fields_schema }),
  z.object({
    action: z.literal("convert"),
    idea_id: id_schema,
    converted_to: z.object({ kind: z.enum(IDEA_TARGET_KINDS), id: z.string().min(1).max(128) }),
  }),
  z.object({ action: z.literal("restore"), idea_id: id_schema }),
]);
export type UpdateIdeaInput = z.infer<typeof update_idea_input_schema>;

export const delete_idea_input_schema = z.object({ idea_id: id_schema });
export type DeleteIdeaInput = z.infer<typeof delete_idea_input_schema>;

export const react_to_idea_input_schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("like"), idea_id: id_schema, liked: z.boolean() }),
  z.object({
    action: z.literal("comment"),
    idea_id: id_schema,
    comment_id: id_schema,
    text: z.string().max(MAX_COMMENT_LENGTH * 2),
  }),
  z.object({ action: z.literal("delete_comment"), idea_id: id_schema, comment_id: id_schema }),
]);
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
  converted_to: { kind: IdeaTargetKind; id: string } | null;
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
