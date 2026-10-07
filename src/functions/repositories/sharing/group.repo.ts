/**
 * Group Repository (D4, D30)
 *
 * `groups/{groupId}` plus each member's `users/{uid}.groupIds`. A membership
 * change touches both, so `apply_mutation` runs in ONE Firestore transaction:
 * it re-reads the group and the users, hands them to the (pure) domain rule the
 * orchestrator passes in, and writes the result. Limits (3 groups per user, 50
 * members) are therefore checked against fresh data and can't be raced past.
 *
 * Clients read `groups` only through callables (rules: members only).
 *
 * @module repositories/sharing/group
 */

import { getFirestore, Timestamp, Transaction } from "firebase-admin/firestore";
import { DomainResult, TraceContext } from "../../types";
import { Group, GroupMember, GroupMutation, GroupRole } from "../../types/sharing.types";

const COLLECTION = "groups";
const USERS = "users";

/* eslint-disable @typescript-eslint/naming-convention */
interface GroupMemberDoc {
  role: GroupRole;
  joinedAt: Timestamp;
}

interface GroupDoc {
  name: string;
  ownerId: string;
  members: Record<string, GroupMemberDoc>;
  memberIds: string[];
  createdAt: Timestamp;
  deletedAt: Timestamp | null;
  updatedAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

function to_domain(id: string, doc: GroupDoc): Group {
  const members: Record<string, GroupMember> = {};
  for (const [uid, m] of Object.entries(doc.members ?? {})) {
    members[uid] = { role: m.role, joined_at_ms: m.joinedAt.toMillis() };
  }
  return {
    id,
    name: doc.name,
    owner_id: doc.ownerId,
    members,
    member_ids: doc.memberIds ?? [],
    created_at_ms: doc.createdAt.toMillis(),
    deleted_at_ms: doc.deletedAt ? doc.deletedAt.toMillis() : null,
  };
}

function to_doc(entity: Group, now_ms: number): GroupDoc {
  const members: Record<string, GroupMemberDoc> = {};
  for (const [uid, m] of Object.entries(entity.members)) {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    members[uid] = { role: m.role, joinedAt: Timestamp.fromMillis(m.joined_at_ms) };
  }
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    name: entity.name,
    ownerId: entity.owner_id,
    members,
    memberIds: entity.member_ids,
    createdAt: Timestamp.fromMillis(entity.created_at_ms),
    deletedAt: entity.deleted_at_ms ? Timestamp.fromMillis(entity.deleted_at_ms) : null,
    updatedAt: Timestamp.fromMillis(now_ms),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

const groups = () => getFirestore().collection(COLLECTION);
const users = () => getFirestore().collection(USERS);

/** Computes a mutation from fresh data. `group_counts`: uid → number of groups. */
export type MutationRule = (
  group: Group | null,
  group_counts: Record<string, number>
) => DomainResult<GroupMutation>;

export const group_repo = {
  new_id(): string {
    return groups().doc().id;
  },

  async get(_ctx: TraceContext, group_id: string): Promise<Group | null> {
    const snap = await groups().doc(group_id).get();
    return snap.exists ? to_domain(snap.id, snap.data() as GroupDoc) : null;
  },

  /** Group docs by id (missing ids are skipped). */
  async get_many(_ctx: TraceContext, group_ids: string[]): Promise<Group[]> {
    const unique = [...new Set(group_ids)];
    if (unique.length === 0) return [];
    const snaps = await getFirestore().getAll(...unique.map((id) => groups().doc(id)));
    return snaps
      .filter((s) => s.exists)
      .map((s) => to_domain(s.id, s.data() as GroupDoc));
  },

  /** A user's active groups. */
  async get_for_user(_ctx: TraceContext, user_id: string): Promise<Group[]> {
    const snap = await groups().where("memberIds", "array-contains", user_id).get();
    return snap.docs
      .map((d) => to_domain(d.id, d.data() as GroupDoc))
      .filter((g) => g.deleted_at_ms === null);
  },

  /**
   * Applies a membership change atomically.
   *
   * Reads the group (if `group_id` exists) and the `users` docs of every member,
   * `count_user_ids`, and every user the rule changes; runs `rule`; on success
   * writes the group doc and each user's `groupIds`; `extra` adds writes to the
   * same transaction (e.g. marking a request accepted).
   *
   * @returns the rule's result (validation errors → nothing written)
   */
  async apply_mutation(
    _ctx: TraceContext,
    group_id: string,
    count_user_ids: string[],
    rule: MutationRule,
    now_ms: number,
    extra?: (tx: Transaction, mutation: GroupMutation) => void
  ): Promise<DomainResult<GroupMutation>> {
    return getFirestore().runTransaction(async (tx) => {
      const group_snap = await tx.get(groups().doc(group_id));
      const group = group_snap.exists
        ? to_domain(group_snap.id, group_snap.data() as GroupDoc)
        : null;

      const uids = [...new Set([...(group?.member_ids ?? []), ...count_user_ids])];
      const user_snaps = uids.length
        ? await tx.getAll(...uids.map((uid) => users().doc(uid)))
        : [];
      const group_ids_of: Record<string, string[]> = {};
      for (const s of user_snaps) {
        group_ids_of[s.id] = (s.data()?.groupIds as string[] | undefined) ?? [];
      }
      const group_counts: Record<string, number> = {};
      for (const uid of uids) group_counts[uid] = (group_ids_of[uid] ?? []).length;

      const result = rule(group, group_counts);
      if (result.validation_errors?.length || !result.entity) return result;
      const mutation = result.entity;

      // Every user the rule changes must have been read above (transactions read
      // before they write); the rule only touches members or counted users.
      for (const change of mutation.user_changes) {
        if (!(change.user_id in group_ids_of) && !uids.includes(change.user_id)) {
          throw new Error(`apply_mutation: user ${change.user_id} was not read`);
        }
      }

      tx.set(groups().doc(mutation.group.id), to_doc(mutation.group, now_ms));
      for (const change of mutation.user_changes) {
        const current = new Set(group_ids_of[change.user_id] ?? []);
        if (change.add) current.add(change.add);
        if (change.remove) current.delete(change.remove);
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        tx.set(users().doc(change.user_id), { groupIds: [...current] }, { merge: true });
      }
      if (extra) extra(tx, mutation);
      return result;
    });
  },
};
