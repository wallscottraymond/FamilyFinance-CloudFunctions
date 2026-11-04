/**
 * derive_addable_transactions — onCall entry: what can be added to a budget by hand in a period
 * (Manual-Budgets). Read-only. A view the caller isn't a member of is refused by the scope check.
 *
 * @module entry/callable/derive_addable_transactions
 */
export declare const derive_addable_transactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    rows: import("../../orchestrators/budgets/derive_budget_transactions.orchestrator").AddableTransaction[];
}>, unknown>;
//# sourceMappingURL=derive_addable_transactions.entry.d.ts.map