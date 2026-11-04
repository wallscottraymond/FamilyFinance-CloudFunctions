"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.budget_checklist_repo = void 0;
/**
 * budget_checklists/{budgetId} — a budget's checklist (Manual-Budgets, AF-02), in its own doc so a
 * tick isn't a budget write: the phone's budget listener and the derive version don't move, because
 * no number depends on it. Bounded by `CHECKLIST_MAX_ITEMS`. Server writes only.
 *
 * @module repositories/budget_checklist
 */
const firestore_1 = require("firebase-admin/firestore");
const budget_checklist_service_1 = require("../domain/budgets/budget_checklist.service");
const COLLECTION = "budget_checklists";
const doc_ref = (budget_id) => (0, firestore_1.getFirestore)().collection(COLLECTION).doc(budget_id);
const read_doc = (data) => {
    var _a, _b;
    return ({
        carry: (data === null || data === void 0 ? void 0 : data.carry) !== false,
        items: (_a = data === null || data === void 0 ? void 0 : data.items) !== null && _a !== void 0 ? _a : [],
        ticks: (_b = data === null || data === void 0 ? void 0 : data.ticks) !== null && _b !== void 0 ? _b : {},
    });
};
exports.budget_checklist_repo = {
    async get(budget_id) {
        const snap = await doc_ref(budget_id).get();
        return snap.exists ? read_doc(snap.data()) : budget_checklist_service_1.EMPTY_CHECKLIST;
    },
    /** One edit, in a transaction, so simultaneous edits both land. Returns the list, or the errors. */
    async apply(budget_id, owner_key, op) {
        return (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(doc_ref(budget_id));
            const result = (0, budget_checklist_service_1.apply_checklist_op)(read_doc(snap.data()), op);
            if (result.checklist) {
                /* eslint-disable @typescript-eslint/naming-convention */
                tx.set(doc_ref(budget_id), Object.assign(Object.assign({}, result.checklist), { userId: owner_key, updatedAt: firestore_1.Timestamp.now() }));
                /* eslint-enable @typescript-eslint/naming-convention */
            }
            return result;
        });
    },
    /** A budget moved views: its list follows, so a purge finds it under the right owner. */
    async set_owner(budget_id, owner_key) {
        const ref = doc_ref(budget_id);
        if ((await ref.get()).exists) {
            /* eslint-disable-next-line @typescript-eslint/naming-convention */
            await ref.update({ userId: owner_key, updatedAt: firestore_1.Timestamp.now() });
        }
    },
    async delete(budget_id) {
        await doc_ref(budget_id).delete();
    },
};
//# sourceMappingURL=budget_checklist.repo.js.map