/**
 * The checklist's callables (Manual-Budgets, AF-02). `get_budget_checklist` reads it;
 * `edit_budget_checklist` applies one edit, so two people's changes both survive. Any member may edit
 * a group budget's, like every budget edit. A budget the caller can't manage reads as not found.
 *
 * @module entry/callable/set_budget_checklist
 */
export declare const get_budget_checklist: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    checklist: import("../../domain/budgets/budget_checklist.service").BudgetChecklist;
}>, unknown>;
export declare const edit_budget_checklist: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    checklist: import("../../domain/budgets/budget_checklist.service").BudgetChecklist;
}>, unknown>;
//# sourceMappingURL=set_budget_checklist.entry.d.ts.map