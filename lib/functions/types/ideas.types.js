"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.react_to_idea_input_schema = exports.delete_idea_input_schema = exports.update_idea_input_schema = exports.idea_fields_schema = exports.create_idea_input_schema = exports.IDEA_DATE_PATTERN = exports.IDEA_ID_PATTERN = exports.IDEAS_FLAG = exports.MAX_IDEA_AMOUNT = exports.CONVERTED_RETENTION_MS = exports.MAX_OPEN_IDEAS = exports.MAX_LIKES = exports.MAX_COMMENTS_PER_IDEA = exports.MAX_TOPICS = exports.MAX_COMMENT_LENGTH = exports.MAX_TOPIC_NAME = exports.MAX_IDEA_NOTES = exports.MAX_IDEA_TITLE = exports.IDEA_TARGET_KINDS = exports.IDEA_KINDS = void 0;
const zod_1 = require("zod");
/** What the person says the idea is (D7: picked, never guessed). */
exports.IDEA_KINDS = ["idea", "bill", "budget", "goal"];
/** What an idea can become (D5). */
exports.IDEA_TARGET_KINDS = ["bill", "budget", "goal"];
exports.MAX_IDEA_TITLE = 120;
exports.MAX_IDEA_NOTES = 2000;
exports.MAX_TOPIC_NAME = 40;
exports.MAX_COMMENT_LENGTH = 1000;
/** Bounds (rule #9): topics per list, comments per idea, likes per idea (= group size cap). */
exports.MAX_TOPICS = 30;
exports.MAX_COMMENTS_PER_IDEA = 200;
exports.MAX_LIKES = 50;
/** Open ideas one list may hold (the app's listener reads at most this many). */
exports.MAX_OPEN_IDEAS = 500;
/** A converted idea is kept this long (TTL on `expireAt`), then Firestore removes it. */
exports.CONVERTED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
exports.MAX_IDEA_AMOUNT = 10000000;
/** Owner allowlist / rollout for the whole feature (`_feature_flags/ideas_v1`). */
exports.IDEAS_FLAG = "ideas_v1";
/** Client-made ids (idea, comment): Firestore-safe, unguessable length. */
exports.IDEA_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
exports.IDEA_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const id_schema = zod_1.z.string().regex(exports.IDEA_ID_PATTERN, "id is malformed");
const view_group_id = zod_1.z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, "view_group_id is malformed")
    .optional();
// Payload guards only: the real limits are checked after cleanup in the domain.
const title_schema = zod_1.z.string().max(exports.MAX_IDEA_TITLE * 2);
const notes_schema = zod_1.z.string().max(exports.MAX_IDEA_NOTES * 2);
const topic_schema = zod_1.z.string().max(exports.MAX_TOPIC_NAME * 2).nullable();
const amount_schema = zod_1.z.number().finite().min(0).max(exports.MAX_IDEA_AMOUNT).nullable();
const date_schema = zod_1.z.string().regex(exports.IDEA_DATE_PATTERN, "date must be YYYY-MM-DD").nullable();
exports.create_idea_input_schema = zod_1.z.object({
    idea_id: id_schema,
    view_group_id,
    title: title_schema,
    notes: notes_schema.optional(),
    kind: zod_1.z.enum(exports.IDEA_KINDS).optional(),
    topic: topic_schema.optional(),
    amount: amount_schema.optional(),
    date: date_schema.optional(),
});
/** The editable fields; a field left out is unchanged, `null` clears it. */
exports.idea_fields_schema = zod_1.z
    .object({
    title: title_schema.optional(),
    notes: notes_schema.optional(),
    kind: zod_1.z.enum(exports.IDEA_KINDS).optional(),
    topic: topic_schema.optional(),
    amount: amount_schema.optional(),
    date: date_schema.optional(),
})
    .strict();
exports.update_idea_input_schema = zod_1.z.discriminatedUnion("action", [
    zod_1.z.object({ action: zod_1.z.literal("edit"), idea_id: id_schema, fields: exports.idea_fields_schema }),
    zod_1.z.object({
        action: zod_1.z.literal("convert"),
        idea_id: id_schema,
        converted_to: zod_1.z.object({ kind: zod_1.z.enum(exports.IDEA_TARGET_KINDS), id: zod_1.z.string().min(1).max(128) }),
    }),
    zod_1.z.object({ action: zod_1.z.literal("restore"), idea_id: id_schema }),
]);
exports.delete_idea_input_schema = zod_1.z.object({ idea_id: id_schema });
exports.react_to_idea_input_schema = zod_1.z.discriminatedUnion("action", [
    zod_1.z.object({ action: zod_1.z.literal("like"), idea_id: id_schema, liked: zod_1.z.boolean() }),
    zod_1.z.object({
        action: zod_1.z.literal("comment"),
        idea_id: id_schema,
        comment_id: id_schema,
        text: zod_1.z.string().max(exports.MAX_COMMENT_LENGTH * 2),
    }),
    zod_1.z.object({ action: zod_1.z.literal("delete_comment"), idea_id: id_schema, comment_id: id_schema }),
]);
//# sourceMappingURL=ideas.types.js.map