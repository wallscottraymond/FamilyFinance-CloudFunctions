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

import { getFirestore, Timestamp, DocumentData } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { IdeaPlan, IdeaTopics } from "../domain/ideas/idea.service";
import {
  IDEA_KINDS,
  IDEA_TARGET_KINDS,
  Idea,
  IdeaComment,
  IdeaKind,
  IdeaTargetKind,
  MAX_COMMENTS_PER_IDEA,
} from "../types/ideas.types";

export const IDEAS_COLLECTION = "ideas";
export const IDEA_COMMENTS_COLLECTION = "idea_comments";
export const IDEA_TOPICS_COLLECTION = "idea_topics";

/** Batch size when deleting a whole list. */
const DELETE_PAGE = 400;

type Collection = FirebaseFirestore.CollectionReference;
const ideas = (): Collection => getFirestore().collection(IDEAS_COLLECTION);
const comments = (): Collection => getFirestore().collection(IDEA_COMMENTS_COLLECTION);
const topics = (): Collection => getFirestore().collection(IDEA_TOPICS_COLLECTION);

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms);
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/* eslint-disable @typescript-eslint/naming-convention */
function idea_to_doc(idea: Idea): DocumentData {
  return {
    userId: idea.owner_key,
    createdBy: idea.created_by,
    title: idea.title,
    notes: idea.notes,
    kind: idea.kind,
    topic: idea.topic,
    amount: idea.amount,
    date: idea.date,
    likedBy: idea.liked_by,
    commentCount: idea.comment_count,
    status: idea.status,
    convertedTo: idea.converted_to,
    createdAt: ts(idea.created_at_ms),
    updatedAt: ts(idea.updated_at_ms),
    updatedBy: idea.updated_by,
    expireAt: idea.expire_at_ms === null ? null : ts(idea.expire_at_ms),
  };
}

function comment_to_doc(c: IdeaComment): DocumentData {
  return {
    ideaId: c.idea_id,
    userId: c.owner_key,
    authorId: c.author_id,
    text: c.text,
    createdAt: ts(c.created_at_ms),
    // Set while the idea is converted (TTL removes the comments with it).
    expireAt: null,
  };
}
function topics_to_doc(owner_key: string, t: IdeaTopics): DocumentData {
  return { userId: owner_key, topics: t.names, counts: t.counts, updatedAt: Timestamp.now() };
}
/* eslint-enable @typescript-eslint/naming-convention */

function doc_to_idea(id: string, d: DocumentData): Idea {
  const kind: IdeaKind = (IDEA_KINDS as readonly string[]).includes(d.kind) ? d.kind : "idea";
  const to = d.convertedTo;
  const converted_to =
    to && (IDEA_TARGET_KINDS as readonly string[]).includes(to.kind) && typeof to.id === "string"
      ? { kind: to.kind as IdeaTargetKind, id: to.id as string }
      : null;
  return {
    id,
    owner_key: str(d.userId) ?? "",
    created_by: str(d.createdBy) ?? "",
    title: typeof d.title === "string" ? d.title : "",
    notes: typeof d.notes === "string" ? d.notes : "",
    kind,
    topic: str(d.topic),
    amount: num(d.amount),
    date: str(d.date),
    liked_by: strings(d.likedBy),
    comment_count: num(d.commentCount) ?? 0,
    status: d.status === "converted" ? "converted" : "open",
    converted_to,
    created_at_ms: ms(d.createdAt),
    updated_at_ms: ms(d.updatedAt),
    updated_by: str(d.updatedBy) ?? "",
    expire_at_ms: d.expireAt instanceof Timestamp ? d.expireAt.toMillis() : null,
  };
}

function doc_to_comment(id: string, d: DocumentData): IdeaComment {
  return {
    id,
    idea_id: str(d.ideaId) ?? "",
    owner_key: str(d.userId) ?? "",
    author_id: str(d.authorId) ?? "",
    text: typeof d.text === "string" ? d.text : "",
    created_at_ms: ms(d.createdAt),
  };
}

function doc_to_topics(d: DocumentData | undefined): IdeaTopics {
  const names = strings(d?.topics);
  const raw = (d?.counts ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  names.forEach((n) => (counts[n] = typeof raw[n] === "number" ? (raw[n] as number) : 0));
  return { names, counts };
}

/** What one transaction reads: the idea, the list's topics, and (for comment actions) a comment. */
export interface IdeaSnapshot {
  idea: Idea | null;
  topics: IdeaTopics;
  comment: IdeaComment | null;
}

export const idea_repo = {
  async get(_ctx: TraceContext, idea_id: string): Promise<Idea | null> {
    const snap = await ideas().doc(idea_id).get();
    return snap.exists ? doc_to_idea(snap.id, snap.data() as DocumentData) : null;
  },

  /** Open ideas in one list (aggregation: one read per 1,000). */
  async count_open(_ctx: TraceContext, owner_key: string): Promise<number> {
    const agg = await ideas()
      .where("userId", "==", owner_key)
      .where("status", "==", "open")
      .count()
      .get();
    return agg.data().count;
  },

  /**
   * One action, atomically: read the idea, the list's topics and (optionally) a comment; let the
   * (pure) plan decide; write the idea (or delete it), the topics and the comment together — or
   * nothing. Returns the plan.
   */
  async apply_in_transaction<R>(
    _ctx: TraceContext,
    refs: { idea_id: string; owner_key: string; comment_id?: string },
    plan: (snap: IdeaSnapshot) => IdeaPlan<R>
  ): Promise<IdeaPlan<R>> {
    if (!refs.idea_id || !refs.owner_key) {
      throw new Error("apply_in_transaction requires idea_id and owner_key");
    }
    const db = getFirestore();
    const idea_ref = ideas().doc(refs.idea_id);
    const topics_ref = topics().doc(refs.owner_key);
    const comment_ref = refs.comment_id ? comments().doc(refs.comment_id) : null;
    return db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(idea_ref, topics_ref, ...(comment_ref ? [comment_ref] : []));
      const [idea_snap, topics_snap, comment_snap] = snaps;
      const planned = plan({
        idea: idea_snap.exists ? doc_to_idea(idea_snap.id, idea_snap.data() as DocumentData) : null,
        topics: doc_to_topics(topics_snap.data()),
        comment:
          comment_snap && comment_snap.exists
            ? doc_to_comment(comment_snap.id, comment_snap.data() as DocumentData)
            : null,
      });
      if (planned.kind !== "write") return planned;

      if (planned.idea) tx.set(idea_ref, idea_to_doc(planned.idea));
      else tx.delete(idea_ref);
      if (planned.topics) {
        tx.set(topics_ref, topics_to_doc(refs.owner_key, planned.topics));
      }
      if (planned.comment && comment_ref) {
        if ("set" in planned.comment) tx.create(comment_ref, comment_to_doc(planned.comment.set));
        else tx.delete(comment_ref);
      }
      return planned;
    });
  },

  /**
   * Stamp (or clear) the TTL on an idea's comments, so they leave with a converted idea and stay
   * when it's restored. Bounded by MAX_COMMENTS_PER_IDEA.
   */
  async set_comments_expiry(
    _ctx: TraceContext,
    idea_id: string,
    owner_key: string,
    expire_at_ms: number | null
  ): Promise<number> {
    const snap = await comments()
      .where("ideaId", "==", idea_id)
      .where("userId", "==", owner_key)
      .limit(MAX_COMMENTS_PER_IDEA + 50)
      .select()
      .get();
    if (snap.empty) return 0;
    const batch = getFirestore().batch();
    const value = expire_at_ms === null ? null : ts(expire_at_ms);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    snap.docs.forEach((d) => batch.update(d.ref, { expireAt: value }));
    await batch.commit();
    return snap.size;
  },

  /**
   * Delete a whole list: every idea and comment with this owner key and its topics doc (a group
   * that closed). Pages of DELETE_PAGE until nothing is left. Returns the docs deleted.
   */
  async delete_list(_ctx: TraceContext, owner_key: string): Promise<number> {
    if (!owner_key) throw new Error("delete_list requires owner_key");
    const db = getFirestore();
    let deleted = 0;
    for (const col of [ideas(), comments()]) {
      for (;;) {
        const page = await col.where("userId", "==", owner_key).limit(DELETE_PAGE).select().get();
        if (page.empty) break;
        const batch = db.batch();
        page.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += page.size;
        if (page.size < DELETE_PAGE) break;
      }
    }
    await topics().doc(owner_key).delete();
    return deleted;
  },

  /** Delete every comment on an idea (bounded by MAX_COMMENTS_PER_IDEA). Returns the count. */
  async delete_comments(_ctx: TraceContext, idea_id: string, owner_key: string): Promise<number> {
    const snap = await comments()
      .where("ideaId", "==", idea_id)
      .where("userId", "==", owner_key)
      .limit(MAX_COMMENTS_PER_IDEA + 50)
      .select()
      .get();
    if (snap.empty) return 0;
    const batch = getFirestore().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snap.size;
  },
};
