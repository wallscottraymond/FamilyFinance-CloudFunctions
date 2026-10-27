/**
 * Feedback Repository (Feedback-And-Questions)
 *
 * - `feedback/{noteId}`: one note. Has NO sender field (D2/D7) — never add one.
 * - `feedback_senders/{uid}`: the sender's own note ids (newest first, bounded) + daily counter.
 *
 * Functions-only: the rules deny every client read and write on both.
 *
 * @module repositories/feedback
 */

import { FieldPath, getFirestore, Timestamp, DocumentData } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import {
  FEEDBACK_TYPES,
  FeedbackNote,
  FeedbackSender,
  FeedbackStatus,
  FeedbackType,
} from "../types/feedback.types";

export const FEEDBACK_COLLECTION = "feedback";
export const FEEDBACK_SENDERS_COLLECTION = "feedback_senders";

/** `getAll` / `in` batch size. */
const READ_CHUNK = 100;

type Collection = FirebaseFirestore.CollectionReference;
const notes = (): Collection => getFirestore().collection(FEEDBACK_COLLECTION);
const senders = (): Collection => getFirestore().collection(FEEDBACK_SENDERS_COLLECTION);

/* eslint-disable @typescript-eslint/naming-convention */
function note_to_doc(note: FeedbackNote): DocumentData {
  return {
    type: note.type,
    message: note.message,
    appVersion: note.app_version,
    build: note.build,
    screen: note.screen,
    device: note.device,
    osVersion: note.os_version,
    createdAt: Timestamp.fromMillis(note.created_at_ms),
    status: note.status,
    readByOwner: note.read_by_owner,
    reply: note.reply
      ? { message: note.reply.message, repliedAt: Timestamp.fromMillis(note.reply.replied_at_ms) }
      : null,
  };
}

function sender_to_doc(sender: FeedbackSender): DocumentData {
  return {
    noteIds: sender.note_ids,
    dailyCount: sender.daily_count,
    dailyDate: sender.daily_date,
    retiredNoteIds: sender.retired_note_ids,
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : 0);

function doc_to_note(id: string, d: DocumentData): FeedbackNote {
  const known = (FEEDBACK_TYPES as readonly string[]).includes(d.type);
  const type: FeedbackType = known ? (d.type as FeedbackType) : "other";
  const reply =
    d.reply && typeof d.reply.message === "string"
      ? { message: d.reply.message as string, replied_at_ms: ms(d.reply.repliedAt) }
      : null;
  return {
    id,
    type,
    message: typeof d.message === "string" ? d.message : "",
    app_version: str(d.appVersion) ?? "",
    build: str(d.build) ?? "",
    screen: str(d.screen),
    device: str(d.device),
    os_version: str(d.osVersion),
    created_at_ms: ms(d.createdAt),
    status: d.status === "done" ? "done" : "open",
    read_by_owner: d.readByOwner === true,
    reply,
  };
}

function doc_to_sender(d: DocumentData | undefined): FeedbackSender | null {
  if (!d) return null;
  return {
    note_ids: Array.isArray(d.noteIds)
      ? d.noteIds.filter((x: unknown) => typeof x === "string")
      : [],
    daily_count: typeof d.dailyCount === "number" ? d.dailyCount : 0,
    daily_date: typeof d.dailyDate === "string" ? d.dailyDate : "",
    retired_note_ids: Array.isArray(d.retiredNoteIds)
      ? d.retiredNoteIds.filter((x: unknown) => typeof x === "string")
      : [],
  };
}

/** What the send transaction's plan returns: write the pair, or don't write. */
export type SubmitWrite<R> = {
  write: { note: FeedbackNote; sender: FeedbackSender } | null;
  result: R;
};

export const feedback_repo = {
  /**
   * The send, atomically: read the sender record + whether the note id exists, let the (pure)
   * plan decide, then write the note and the sender record together — or nothing. `create` (not
   * `set`) on the note is a second guard: an id that appeared since the read fails the commit and
   * the transaction retries against the fresh snapshot.
   */
  async submit_in_transaction<R>(
    _ctx: TraceContext,
    user_id: string,
    note_id: string,
    plan: (sender: FeedbackSender | null, note_exists: boolean) => SubmitWrite<R>
  ): Promise<R> {
    if (!user_id || !note_id) throw new Error("submit_in_transaction requires user_id and note_id");
    const db = getFirestore();
    const sender_ref = senders().doc(user_id);
    const note_ref = notes().doc(note_id);
    return db.runTransaction(async (tx) => {
      const [sender_snap, note_snap] = await tx.getAll(sender_ref, note_ref);
      const planned = plan(doc_to_sender(sender_snap.data()), note_snap.exists);
      if (planned.write) {
        tx.create(note_ref, note_to_doc(planned.write.note));
        tx.set(sender_ref, sender_to_doc(planned.write.sender));
      }
      return planned.result;
    });
  },

  async get_sender(_ctx: TraceContext, user_id: string): Promise<FeedbackSender | null> {
    const snap = await senders().doc(user_id).get();
    return doc_to_sender(snap.data());
  },

  /** Notes by id (missing ids are skipped). */
  async get_notes(_ctx: TraceContext, note_ids: string[]): Promise<FeedbackNote[]> {
    const out: FeedbackNote[] = [];
    for (let i = 0; i < note_ids.length; i += READ_CHUNK) {
      const refs = note_ids.slice(i, i + READ_CHUNK).map((id) => notes().doc(id));
      if (refs.length === 0) continue;
      const snaps = await getFirestore().getAll(...refs);
      for (const s of snaps) if (s.exists) out.push(doc_to_note(s.id, s.data()!));
    }
    return out;
  },

  async get_note(_ctx: TraceContext, note_id: string): Promise<FeedbackNote | null> {
    const snap = await notes().doc(note_id).get();
    return snap.exists ? doc_to_note(snap.id, snap.data()!) : null;
  },

  /**
   * Inbox page: notes with this status (and type, when given), newest first. Reads `limit + 1` so
   * the caller knows whether more exist. Indexes: (status, createdAt desc) and
   * (status, type, createdAt desc).
   */
  async list_inbox(
    _ctx: TraceContext,
    status: FeedbackStatus,
    type: FeedbackType | undefined,
    limit: number
  ): Promise<{ notes: FeedbackNote[]; truncated: boolean }> {
    let q = notes().where("status", "==", status);
    if (type) q = q.where("type", "==", type);
    const snap = await q
      .orderBy("createdAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(limit + 1)
      .get();
    const all = snap.docs.map((d) => doc_to_note(d.id, d.data()));
    return { notes: all.slice(0, limit), truncated: all.length > limit };
  },

  /** Notes the owner hasn't opened (aggregation: one read per 1,000 notes). */
  async count_unread(_ctx: TraceContext): Promise<number> {
    const agg = await notes().where("readByOwner", "==", false).count().get();
    return agg.data().count;
  },

  /**
   * Set inbox fields on a note. Returns false when the note doesn't exist (nothing written) or
   * already has these values (nothing written — no needless write).
   */
  async update_note_fields(
    _ctx: TraceContext,
    note_id: string,
    fields: { status?: FeedbackStatus; read_by_owner?: boolean }
  ): Promise<boolean> {
    const ref = notes().doc(note_id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data()!;
      /* eslint-disable @typescript-eslint/naming-convention */
      const patch: DocumentData = {};
      if (fields.status !== undefined && d.status !== fields.status) patch.status = fields.status;
      if (fields.read_by_owner !== undefined && (d.readByOwner === true) !== fields.read_by_owner) {
        patch.readByOwner = fields.read_by_owner;
      }
      /* eslint-enable @typescript-eslint/naming-convention */
      if (Object.keys(patch).length === 0) return false;
      tx.update(ref, patch);
      return true;
    });
  },

  /**
   * Delete a note and take its id off whichever sender list holds it (found by array-contains —
   * the note itself never says who sent it). `next` computes the sender's new record (list +
   * retired ids). Returns false when the note was already gone.
   */
  async delete_note(
    _ctx: TraceContext,
    note_id: string,
    next: (sender: FeedbackSender) => FeedbackSender
  ): Promise<boolean> {
    const db = getFirestore();
    const ref = notes().doc(note_id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const holders = await tx.get(senders().where("noteIds", "array-contains", note_id).limit(10));
      if (!snap.exists && holders.empty) return false;
      for (const h of holders.docs) {
        const sender = doc_to_sender(h.data())!;
        tx.set(h.ref, sender_to_doc(next(sender)));
      }
      if (snap.exists) tx.delete(ref);
      return snap.exists;
    });
  },
};
