/**
 * budget_checklists/{budgetId} — a budget's checklist (Manual-Budgets, AF-02), in its own doc so a
 * tick isn't a budget write: the phone's budget listener and the derive version don't move, because
 * no number depends on it. Bounded by `CHECKLIST_MAX_ITEMS`. Server writes only.
 *
 * @module repositories/budget_checklist
 */
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  apply_checklist_op,
  BudgetChecklist,
  ChecklistOp,
  EMPTY_CHECKLIST,
} from "../domain/budgets/budget_checklist.service";

const COLLECTION = "budget_checklists";
const doc_ref = (budget_id: string) => getFirestore().collection(COLLECTION).doc(budget_id);

const read_doc = (data: FirebaseFirestore.DocumentData | undefined): BudgetChecklist => ({
  carry: data?.carry !== false,
  items: (data?.items as BudgetChecklist["items"]) ?? [],
  ticks: (data?.ticks as BudgetChecklist["ticks"]) ?? {},
});

export const budget_checklist_repo = {
  async get(budget_id: string): Promise<BudgetChecklist> {
    const snap = await doc_ref(budget_id).get();
    return snap.exists ? read_doc(snap.data()) : EMPTY_CHECKLIST;
  },

  /** A new budget's starting list. Same result on a retry, because the budget's id is deterministic. */
  async create(budget_id: string, owner_key: string, checklist: BudgetChecklist): Promise<void> {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    await doc_ref(budget_id).set({ ...checklist, userId: owner_key, updatedAt: Timestamp.now() });
  },

  /** One edit, in a transaction, so simultaneous edits both land. Returns the list, or the errors. */
  async apply(
    budget_id: string,
    owner_key: string,
    op: ChecklistOp
  ): Promise<{ checklist?: BudgetChecklist; errors?: string[] }> {
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(doc_ref(budget_id));
      const result = apply_checklist_op(read_doc(snap.data()), op);
      if (result.checklist) {
        /* eslint-disable @typescript-eslint/naming-convention */
        tx.set(doc_ref(budget_id), { ...result.checklist, userId: owner_key, updatedAt: Timestamp.now() });
        /* eslint-enable @typescript-eslint/naming-convention */
      }
      return result;
    });
  },

  /** A budget moved views: its list follows, so a purge finds it under the right owner. */
  async set_owner(budget_id: string, owner_key: string): Promise<void> {
    const ref = doc_ref(budget_id);
    if ((await ref.get()).exists) {
      /* eslint-disable-next-line @typescript-eslint/naming-convention */
      await ref.update({ userId: owner_key, updatedAt: Timestamp.now() });
    }
  },

  async delete(budget_id: string): Promise<void> {
    await doc_ref(budget_id).delete();
  },
};
