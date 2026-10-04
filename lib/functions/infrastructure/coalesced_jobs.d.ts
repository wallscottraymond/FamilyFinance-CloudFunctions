/**
 * Coalesced per-write fan-out jobs (Read-Cost-Review-Round-3).
 *
 * Every transaction write used to enqueue its OWN `recompute_budget_spent` and
 * `reconcile_recurring_period` job (dedup keys carried the event id), so a Plaid sync landing 78
 * transactions ran 78 + 78 jobs (~50K reads on 2026-10-02). Both jobs recompute from CURRENT
 * Firestore state when they run, so a burst can safely collapse into one delayed run per key:
 *
 *   recompute_budget_spent      key = user + sorted budget ids + the transaction's UTC day
 *                               (recompute only touches the periods CONTAINING that date, so the
 *                               same budgets + same day = the same periods — exactly equivalent)
 *   reconcile_recurring_period  key = recurring type + id (reconciles that stream's own periods)
 *
 * `coalesce_job` merges only into a still-PENDING job; a write during a run gets a new job, so no
 * change is dropped. Screens are unaffected (they derive on read); only stored mirrors
 * (`budget_periods.spent`, `outflow_periods` reconciliation) settle after the delay + queue sweep.
 */
/** Collapse window for a burst of writes (debounce, like `update_user_summary`). */
export declare const COALESCE_DELAY_SECONDS = 30;
export declare function recompute_coalesce_key(user_id: string, budget_ids: string[], transaction_date_ms: number): string;
export declare function reconcile_coalesce_key(recurring_type: "outflow" | "inflow", recurring_id: string): string;
export declare function enqueue_recompute_budget_spent(input: {
    user_id: string;
    budget_ids: string[];
    transaction_date_ms: number;
    trace_id?: string;
}): Promise<void>;
export declare function enqueue_reconcile_recurring(input: {
    user_id: string;
    recurring_id: string;
    recurring_type: "outflow" | "inflow";
    trace_id?: string;
}): Promise<void>;
//# sourceMappingURL=coalesced_jobs.d.ts.map