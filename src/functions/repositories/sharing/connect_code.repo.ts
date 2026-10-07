/**
 * Connect Code Repository (D24)
 *
 * `connect_codes/{uid}`: the user's current code, who has typed it, and their
 * wrong-code counters. Functions-only (rules deny clients). `expireAt` is a TTL
 * field (policy: delete a day after the code expires).
 *
 * @module repositories/sharing/connect_code
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { ConnectCode } from "../../types/sharing.types";

const COLLECTION = "connect_codes";
const TTL_GRACE_MS = 24 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/naming-convention */
interface ConnectCodeDoc {
  userId: string;
  code?: string;
  expiresAt?: Timestamp;
  entries: Record<string, number>;
  failedAttempts: number;
  cooldownUntil: Timestamp | null;
  expireAt: Timestamp;
  updatedAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

function to_domain(doc: ConnectCodeDoc): ConnectCode {
  return {
    user_id: doc.userId,
    // A doc can exist with only failure counters (no code issued yet).
    code: doc.code ?? "",
    expires_at_ms: doc.expiresAt ? doc.expiresAt.toMillis() : 0,
    entries: doc.entries ?? {},
    failed_attempts: doc.failedAttempts ?? 0,
    cooldown_until_ms: doc.cooldownUntil ? doc.cooldownUntil.toMillis() : 0,
  };
}

function to_doc(entity: ConnectCode, now_ms: number): ConnectCodeDoc {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    userId: entity.user_id,
    code: entity.code,
    expiresAt: Timestamp.fromMillis(entity.expires_at_ms),
    entries: entity.entries,
    failedAttempts: entity.failed_attempts,
    cooldownUntil: entity.cooldown_until_ms ? Timestamp.fromMillis(entity.cooldown_until_ms) : null,
    expireAt: Timestamp.fromMillis(
      Math.max(entity.expires_at_ms, entity.cooldown_until_ms) + TTL_GRACE_MS
    ),
    updatedAt: Timestamp.fromMillis(now_ms),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

const ref = (user_id: string) => getFirestore().collection(COLLECTION).doc(user_id);

export const connect_code_repo = {
  /** The user's code doc, or null. */
  async get_by_user(_ctx: TraceContext, user_id: string): Promise<ConnectCode | null> {
    const snap = await ref(user_id).get();
    return snap.exists ? to_domain(snap.data() as ConnectCodeDoc) : null;
  },

  /** Unexpired code docs with this code (normally 0 or 1). */
  async find_active_by_code(
    _ctx: TraceContext,
    code: string,
    now_ms: number
  ): Promise<ConnectCode[]> {
    const snap = await getFirestore()
      .collection(COLLECTION)
      .where("code", "==", code)
      .limit(5)
      .get();
    return snap.docs
      .map((d) => to_domain(d.data() as ConnectCodeDoc))
      .filter((c) => c.expires_at_ms > now_ms);
  },

  /** Replaces the user's code doc. */
  async save(_ctx: TraceContext, entity: ConnectCode, now_ms: number): Promise<void> {
    await ref(entity.user_id).set(to_doc(entity, now_ms));
  },

  /** Records that `entrant_id` typed `owner_id`'s code (idempotent map write). */
  async record_entry(
    _ctx: TraceContext,
    owner_id: string,
    entrant_id: string,
    at_ms: number
  ): Promise<void> {
    await ref(owner_id).set({ entries: { [entrant_id]: at_ms } }, { merge: true });
  },

  /** Sets the wrong-code counters for a user (creates the doc if needed). */
  async set_failure_state(
    _ctx: TraceContext,
    user_id: string,
    failed_attempts: number,
    cooldown_until_ms: number,
    now_ms: number
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await ref(user_id).set(
      {
        userId: user_id,
        failedAttempts: failed_attempts,
        cooldownUntil: cooldown_until_ms ? Timestamp.fromMillis(cooldown_until_ms) : null,
        expireAt: Timestamp.fromMillis(Math.max(now_ms, cooldown_until_ms) + TTL_GRACE_MS),
        updatedAt: Timestamp.fromMillis(now_ms),
      },
      { merge: true }
    );
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /** Removes the user's code doc (account purge). */
  async delete(_ctx: TraceContext, user_id: string): Promise<void> {
    await ref(user_id).delete();
  },

  /** Expires both people's codes once they've connected (codes are single-use). */
  async expire_codes(_ctx: TraceContext, user_ids: string[], now_ms: number): Promise<void> {
    const batch = getFirestore().batch();
    for (const uid of user_ids) {
      // update (not merge-set): a merged `entries: {}` would keep the old keys.
      batch.update(ref(uid), {
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        expiresAt: Timestamp.fromMillis(now_ms),
        entries: {},
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        failedAttempts: 0,
      });
    }
    await batch.commit();
  },
};
