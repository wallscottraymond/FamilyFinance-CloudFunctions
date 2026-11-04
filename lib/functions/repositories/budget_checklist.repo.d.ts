import { BudgetChecklist, ChecklistOp } from "../domain/budgets/budget_checklist.service";
export declare const budget_checklist_repo: {
    get(budget_id: string): Promise<BudgetChecklist>;
    /** A new budget's starting list. Same result on a retry, because the budget's id is deterministic. */
    create(budget_id: string, owner_key: string, checklist: BudgetChecklist): Promise<void>;
    /** One edit, in a transaction, so simultaneous edits both land. Returns the list, or the errors. */
    apply(budget_id: string, owner_key: string, op: ChecklistOp): Promise<{
        checklist?: BudgetChecklist;
        errors?: string[];
    }>;
    /** A budget moved views: its list follows, so a purge finds it under the right owner. */
    set_owner(budget_id: string, owner_key: string): Promise<void>;
    delete(budget_id: string): Promise<void>;
};
//# sourceMappingURL=budget_checklist.repo.d.ts.map