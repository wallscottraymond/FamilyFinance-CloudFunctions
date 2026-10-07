/**
 * Connection Repository (D24, D27)
 *
 * `connections/{pairId}` where pairId = the two uids sorted, joined by "__".
 * Functions-only. Queried by `userIds array-contains`.
 *
 * @module repositories/sharing/connection
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { Connection, ConnectionStatus } from "../../types/sharing.types";

const COLLECTION = "connections";
/** gRPC status for create() on an existing doc. */
const ALREADY_EXISTS = 6;

/* eslint-disable @typescript-eslint/naming-convention */
interface ConnectionDoc {
  userIds: [string, string];
  status: ConnectionStatus;
  connectedAt: Timestamp;
  blockedBy: string | null;
  nicknames: Record<string, string>;
  updatedAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

function to_domain(id: string, doc: ConnectionDoc): Connection {
  return {
    id,
    user_ids: doc.userIds,
    status: doc.status,
    connected_at_ms: doc.connectedAt.toMillis(),
    blocked_by: doc.blockedBy ?? null,
    nicknames: doc.nicknames ?? {},
  };
}

function to_doc(entity: Connection, now_ms: number): ConnectionDoc {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    userIds: entity.user_ids,
    status: entity.status,
    connectedAt: Timestamp.fromMillis(entity.connected_at_ms),
    blockedBy: entity.blocked_by,
    nicknames: entity.nicknames,
    updatedAt: Timestamp.fromMillis(now_ms),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

const ref = (id: string) => getFirestore().collection(COLLECTION).doc(id);

export const connection_repo = {
  async get(_ctx: TraceContext, pair_id: string): Promise<Connection | null> {
    const snap = await ref(pair_id).get();
    return snap.exists ? to_domain(snap.id, snap.data() as ConnectionDoc) : null;
  },

  /** All of a user's connection docs (connected and blocked). Max ~10 + blocks. */
  async get_for_user(_ctx: TraceContext, user_id: string): Promise<Connection[]> {
    const snap = await getFirestore()
      .collection(COLLECTION)
      .where("userIds", "array-contains", user_id)
      .get();
    return snap.docs.map((d) => to_domain(d.id, d.data() as ConnectionDoc));
  },

  /** Number of active (not blocked) connections for a user. */
  async count_connected(_ctx: TraceContext, user_id: string): Promise<number> {
    const snap = await getFirestore()
      .collection(COLLECTION)
      .where("userIds", "array-contains", user_id)
      .where("status", "==", "connected")
      .count()
      .get();
    return snap.data().count;
  },

  async save(_ctx: TraceContext, entity: Connection, now_ms: number): Promise<void> {
    await ref(entity.id).set(to_doc(entity, now_ms));
  },

  /** Creates the connection unless the pair's doc already exists (two sides connecting at once). */
  async create_if_absent(_ctx: TraceContext, entity: Connection, now_ms: number): Promise<void> {
    try {
      await ref(entity.id).create(to_doc(entity, now_ms));
    } catch (e) {
      if ((e as { code?: number }).code !== ALREADY_EXISTS) throw e;
    }
  },

  async delete(_ctx: TraceContext, pair_id: string): Promise<void> {
    await ref(pair_id).delete();
  },
};
