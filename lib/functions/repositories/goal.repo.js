"use strict";
/**
 * Goal Repository — Goals (Phase 1)
 *
 * Persistence for the `goals` collection. Maps the internal snake_case
 * `GoalEntity` to/from a camelCase Firestore document (matching the rest of the
 * app's stored shape). Reads query by a single field (`ownerId`) and filter the
 * rest in memory, so no new composite indexes are needed (a user has few goals).
 *
 * @module repositories/goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.goal_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "goals";
function doc_ref(id) {
    return (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
}
function map_to_doc(e) {
    var _a, _b, _c, _d, _e, _f;
    return {
        id: e.id,
        userId: e.user_id,
        groupIds: e.group_ids,
        isActive: e.is_active,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
        createdBy: e.created_by,
        ownerId: e.owner_id,
        isPrivate: e.is_private,
        access: {
            ownerId: e.access.owner_id,
            createdBy: e.access.created_by,
            groupIds: e.access.group_ids,
            isPrivate: e.access.is_private,
        },
        goalType: e.goal_type,
        name: e.name,
        status: e.status,
        linkedAccountId: e.linked_account_id,
        targetAmount: (_a = e.target_amount) !== null && _a !== void 0 ? _a : null,
        endDate: (_b = e.end_date) !== null && _b !== void 0 ? _b : null,
        homeCadence: e.home_cadence,
        perPeriodAmount: e.per_period_amount,
        baselineBalance: e.baseline_balance,
        baselineCountsExisting: e.baseline_counts_existing,
        priorityRank: e.priority_rank,
        drawsIncome: e.draws_income,
        linkedRecurringId: (_c = e.linked_recurring_id) !== null && _c !== void 0 ? _c : null,
        apr: (_d = e.apr) !== null && _d !== void 0 ? _d : null,
        minimumPayment: (_e = e.minimum_payment) !== null && _e !== void 0 ? _e : null,
        extraPrincipal: (_f = e.extra_principal) !== null && _f !== void 0 ? _f : null,
    };
}
function map_to_domain(d) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    return {
        id: d.id,
        user_id: d.userId,
        group_ids: (_a = d.groupIds) !== null && _a !== void 0 ? _a : [],
        is_active: d.isActive,
        access: {
            owner_id: (_c = (_b = d.access) === null || _b === void 0 ? void 0 : _b.ownerId) !== null && _c !== void 0 ? _c : d.ownerId,
            created_by: (_e = (_d = d.access) === null || _d === void 0 ? void 0 : _d.createdBy) !== null && _e !== void 0 ? _e : d.createdBy,
            group_ids: (_h = (_g = (_f = d.access) === null || _f === void 0 ? void 0 : _f.groupIds) !== null && _g !== void 0 ? _g : d.groupIds) !== null && _h !== void 0 ? _h : [],
            is_private: (_k = (_j = d.access) === null || _j === void 0 ? void 0 : _j.isPrivate) !== null && _k !== void 0 ? _k : d.isPrivate,
        },
        created_by: d.createdBy,
        owner_id: d.ownerId,
        is_private: d.isPrivate,
        goal_type: d.goalType,
        name: d.name,
        status: d.status,
        linked_account_id: d.linkedAccountId,
        target_amount: (_l = d.targetAmount) !== null && _l !== void 0 ? _l : null,
        end_date: (_m = d.endDate) !== null && _m !== void 0 ? _m : null,
        home_cadence: d.homeCadence,
        per_period_amount: d.perPeriodAmount,
        baseline_balance: d.baselineBalance,
        baseline_counts_existing: d.baselineCountsExisting,
        priority_rank: d.priorityRank,
        draws_income: d.drawsIncome,
        linked_recurring_id: (_o = d.linkedRecurringId) !== null && _o !== void 0 ? _o : null,
        apr: (_p = d.apr) !== null && _p !== void 0 ? _p : null,
        minimum_payment: (_q = d.minimumPayment) !== null && _q !== void 0 ? _q : null,
        extra_principal: (_r = d.extraPrincipal) !== null && _r !== void 0 ? _r : null,
        created_at: d.createdAt,
        updated_at: d.updatedAt,
    };
}
/* eslint-enable @typescript-eslint/naming-convention */
function strip_undefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
exports.goal_repo = {
    new_id() {
        return (0, firestore_1.getFirestore)().collection(COLLECTION).doc().id;
    },
    async save(_ctx, entity) {
        const doc = strip_undefined(map_to_doc(entity));
        await doc_ref(entity.id).set(doc);
    },
    async get_by_id(_ctx, id) {
        const snap = await doc_ref(id).get();
        if (!snap.exists)
            return null;
        return map_to_domain(snap.data());
    },
    /** All of the user's active goals (single-field query + in-memory active filter). */
    async get_by_user(_ctx, user_id) {
        const db = (0, firestore_1.getFirestore)();
        const snap = await db
            .collection(COLLECTION)
            .where("ownerId", "==", user_id)
            .get();
        return snap.docs
            .map((d) => map_to_domain(d.data()))
            .filter((g) => g.is_active);
    },
    /** The user's active goals tied to one account (for priority rank + partition). */
    async get_by_account(ctx, user_id, account_id) {
        const all = await this.get_by_user(ctx, user_id);
        return all.filter((g) => g.linked_account_id === account_id);
    },
    /** Patch selected camelCase fields (always bumps updatedAt). */
    async update(_ctx, id, patch) {
        /* eslint-disable-next-line @typescript-eslint/naming-convention */
        await doc_ref(id).update(strip_undefined(Object.assign(Object.assign({}, patch), { updatedAt: firestore_1.Timestamp.now() })));
    },
    /** Soft-delete: deactivate + archive (recoverable). */
    async soft_delete(_ctx, id) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await doc_ref(id).update({
            isActive: false,
            status: "archived",
            updatedAt: firestore_1.Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
};
//# sourceMappingURL=goal.repo.js.map