/**
 * Tags Repository — the user's tag catalog (`tags` collection).
 *
 * Top-level fields are camelCase (`userId`); one small doc per tag. The catalog loads once
 * (single-field `userId` query, no composite index) and is sorted in memory.
 *
 * @module repositories/tags
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { Tag } from "../types/tags.types";

const COLLECTION = "tags";
const col = (): FirebaseFirestore.CollectionReference =>
  getFirestore().collection(COLLECTION);

type TagWriteFields = { name: string; color: string };

export const tags_repo = {
  /** All of a user's tags, name-sorted. */
  async list_tags(_ctx: TraceContext, user_id: string): Promise<Tag[]> {
    const snap = await col().where("userId", "==", user_id).get();
    return snap.docs
      .map((d) => map_to_domain(d.id, d.data()))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Count a user's tags (for the cap). */
  async count_tags(_ctx: TraceContext, user_id: string): Promise<number> {
    const agg = await col().where("userId", "==", user_id).count().get();
    return agg.data().count;
  },

  /** Create a tag; returns the new id. */
  async create_tag(
    _ctx: TraceContext,
    user_id: string,
    fields: TagWriteFields
  ): Promise<string> {
    const now = Timestamp.now();
    /* eslint-disable @typescript-eslint/naming-convention */
    const ref = await col().add({
      userId: user_id,
      name: fields.name,
      color: fields.color,
      createdAt: now,
      updatedAt: now,
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    return ref.id;
  },

  /** Load one tag (ownership checked by the caller). */
  async get_tag(_ctx: TraceContext, tag_id: string): Promise<Tag | null> {
    const doc = await col().doc(tag_id).get();
    return doc.exists
      ? map_to_domain(doc.id, doc.data() as FirebaseFirestore.DocumentData)
      : null;
  },

  /** Patch a tag's editable fields (name/color). */
  async update_tag(
    _ctx: TraceContext,
    tag_id: string,
    patch: Partial<TagWriteFields>
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const update: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.color !== undefined) update.color = patch.color;
    /* eslint-enable @typescript-eslint/naming-convention */
    await col().doc(tag_id).update(update);
  },

  /** Delete the catalog doc. (Stripping the id off tagged docs/rules is added in later phases,
   *  once `tagIds`/budget tags/rule-tag refs exist to strip.) */
  async delete_tag(_ctx: TraceContext, tag_id: string): Promise<void> {
    await col().doc(tag_id).delete();
  },
};

/** Map a Firestore tag doc to the domain `Tag`. */
function map_to_domain(id: string, data: FirebaseFirestore.DocumentData): Tag {
  /* eslint-disable @typescript-eslint/naming-convention */
  const d = data as { userId?: string; name?: string; color?: string };
  /* eslint-enable @typescript-eslint/naming-convention */
  return {
    id,
    user_id: d.userId ?? "",
    name: d.name ?? "",
    color: d.color ?? "#8E8E93",
  };
}
