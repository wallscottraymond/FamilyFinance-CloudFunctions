/**
 * Request Repository (D25, D26)
 *
 * `requests/{id}`: offers waiting for the recipient's Accept. Functions-only.
 * `expireAt` is a TTL field (30 days after the request expires).
 *
 * Indexes: (toUserId, status), (fromUserId, createdAt), (groupId, status).
 *
 * @module repositories/sharing/request
 */

import { getFirestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { RequestStatus, RequestType, SharingRequest } from "../../types/sharing.types";

const COLLECTION = "requests";
const TTL_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/naming-convention */
interface RequestDoc {
  type: RequestType;
  fromUserId: string;
  toUserId: string;
  groupId: string;
  status: RequestStatus;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  respondedAt: Timestamp | null;
  expireAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

function to_domain(id: string, doc: RequestDoc): SharingRequest {
  return {
    id,
    type: doc.type,
    from_user_id: doc.fromUserId,
    to_user_id: doc.toUserId,
    group_id: doc.groupId,
    status: doc.status,
    created_at_ms: doc.createdAt.toMillis(),
    expires_at_ms: doc.expiresAt.toMillis(),
    responded_at_ms: doc.respondedAt ? doc.respondedAt.toMillis() : null,
  };
}

function to_doc(entity: SharingRequest): RequestDoc {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    type: entity.type,
    fromUserId: entity.from_user_id,
    toUserId: entity.to_user_id,
    groupId: entity.group_id,
    status: entity.status,
    createdAt: Timestamp.fromMillis(entity.created_at_ms),
    expiresAt: Timestamp.fromMillis(entity.expires_at_ms),
    respondedAt: entity.responded_at_ms ? Timestamp.fromMillis(entity.responded_at_ms) : null,
    expireAt: Timestamp.fromMillis(entity.expires_at_ms + TTL_GRACE_MS),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

const collection = () => getFirestore().collection(COLLECTION);

export const request_repo = {
  /** A new doc id (domain builds the entity with it). */
  new_id(): string {
    return collection().doc().id;
  },

  async get(_ctx: TraceContext, id: string): Promise<SharingRequest | null> {
    const snap = await collection().doc(id).get();
    return snap.exists ? to_domain(snap.id, snap.data() as RequestDoc) : null;
  },

  /** Pending requests addressed to a user. */
  async get_pending_for_recipient(
    _ctx: TraceContext,
    user_id: string
  ): Promise<SharingRequest[]> {
    const snap = await collection()
      .where("toUserId", "==", user_id)
      .where("status", "==", "pending")
      .limit(100)
      .get();
    return snap.docs.map((d) => to_domain(d.id, d.data() as RequestDoc));
  },

  /** Requests a sender created since `since_ms` (for the daily limit). */
  async get_sent_since(
    _ctx: TraceContext,
    user_id: string,
    since_ms: number
  ): Promise<SharingRequest[]> {
    const snap = await collection()
      .where("fromUserId", "==", user_id)
      .where("createdAt", ">=", Timestamp.fromMillis(since_ms))
      .limit(200)
      .get();
    return snap.docs.map((d) => to_domain(d.id, d.data() as RequestDoc));
  },

  /** Pending requests for a group (to cancel them when the group goes away). */
  async get_pending_for_group(
    _ctx: TraceContext,
    group_id: string
  ): Promise<SharingRequest[]> {
    const snap = await collection()
      .where("groupId", "==", group_id)
      .where("status", "==", "pending")
      .limit(500)
      .get();
    return snap.docs.map((d) => to_domain(d.id, d.data() as RequestDoc));
  },

  /** Writes requests in one batch. */
  async save_many(_ctx: TraceContext, entities: SharingRequest[]): Promise<void> {
    if (entities.length === 0) return;
    const batch = getFirestore().batch();
    for (const e of entities) batch.set(collection().doc(e.id), to_doc(e));
    await batch.commit();
  },

  /** Writes a request inside a caller's transaction. */
  set_in_transaction(tx: Transaction, entity: SharingRequest): void {
    tx.set(collection().doc(entity.id), to_doc(entity));
  },
};
