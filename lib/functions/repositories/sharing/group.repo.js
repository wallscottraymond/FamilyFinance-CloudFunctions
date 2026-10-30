"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.group_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "groups";
const USERS = "users";
/* eslint-enable @typescript-eslint/naming-convention */
function to_domain(id, doc) {
    var _a, _b;
    const members = {};
    for (const [uid, m] of Object.entries((_a = doc.members) !== null && _a !== void 0 ? _a : {})) {
        members[uid] = { role: m.role, joined_at_ms: m.joinedAt.toMillis() };
    }
    return {
        id,
        name: doc.name,
        owner_id: doc.ownerId,
        members,
        member_ids: (_b = doc.memberIds) !== null && _b !== void 0 ? _b : [],
        created_at_ms: doc.createdAt.toMillis(),
        deleted_at_ms: doc.deletedAt ? doc.deletedAt.toMillis() : null,
    };
}
function to_doc(entity, now_ms) {
    const members = {};
    for (const [uid, m] of Object.entries(entity.members)) {
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        members[uid] = { role: m.role, joinedAt: firestore_1.Timestamp.fromMillis(m.joined_at_ms) };
    }
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        name: entity.name,
        ownerId: entity.owner_id,
        members,
        memberIds: entity.member_ids,
        createdAt: firestore_1.Timestamp.fromMillis(entity.created_at_ms),
        deletedAt: entity.deleted_at_ms ? firestore_1.Timestamp.fromMillis(entity.deleted_at_ms) : null,
        updatedAt: firestore_1.Timestamp.fromMillis(now_ms),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
const groups = () => (0, firestore_1.getFirestore)().collection(COLLECTION);
const users = () => (0, firestore_1.getFirestore)().collection(USERS);
exports.group_repo = {
    new_id() {
        return groups().doc().id;
    },
    async get(_ctx, group_id) {
        const snap = await groups().doc(group_id).get();
        return snap.exists ? to_domain(snap.id, snap.data()) : null;
    },
    /** Group docs by id (missing ids are skipped). */
    async get_many(_ctx, group_ids) {
        const unique = [...new Set(group_ids)];
        if (unique.length === 0)
            return [];
        const snaps = await (0, firestore_1.getFirestore)().getAll(...unique.map((id) => groups().doc(id)));
        return snaps
            .filter((s) => s.exists)
            .map((s) => to_domain(s.id, s.data()));
    },
    /** A user's active groups. */
    async get_for_user(_ctx, user_id) {
        const snap = await groups().where("memberIds", "array-contains", user_id).get();
        return snap.docs
            .map((d) => to_domain(d.id, d.data()))
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
    async apply_mutation(_ctx, group_id, count_user_ids, rule, now_ms, extra) {
        return (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a, _b, _c, _d, _e, _f;
            const group_snap = await tx.get(groups().doc(group_id));
            const group = group_snap.exists
                ? to_domain(group_snap.id, group_snap.data())
                : null;
            const uids = [...new Set([...((_a = group === null || group === void 0 ? void 0 : group.member_ids) !== null && _a !== void 0 ? _a : []), ...count_user_ids])];
            const user_snaps = uids.length
                ? await tx.getAll(...uids.map((uid) => users().doc(uid)))
                : [];
            const group_ids_of = {};
            for (const s of user_snaps) {
                group_ids_of[s.id] = (_c = (_b = s.data()) === null || _b === void 0 ? void 0 : _b.groupIds) !== null && _c !== void 0 ? _c : [];
            }
            const group_counts = {};
            for (const uid of uids)
                group_counts[uid] = ((_d = group_ids_of[uid]) !== null && _d !== void 0 ? _d : []).length;
            const result = rule(group, group_counts);
            if (((_e = result.validation_errors) === null || _e === void 0 ? void 0 : _e.length) || !result.entity)
                return result;
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
                const current = new Set((_f = group_ids_of[change.user_id]) !== null && _f !== void 0 ? _f : []);
                if (change.add)
                    current.add(change.add);
                if (change.remove)
                    current.delete(change.remove);
                /* eslint-disable-next-line @typescript-eslint/naming-convention */
                tx.set(users().doc(change.user_id), { groupIds: [...current] }, { merge: true });
            }
            if (extra)
                extra(tx, mutation);
            return result;
        });
    },
};
//# sourceMappingURL=group.repo.js.map