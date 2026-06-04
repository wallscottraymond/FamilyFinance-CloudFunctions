/**
 * Budget Period Repository
 *
 * Persistence for budget_periods. Scoped to what the budget CRUD migration
 * needs: listing and batch-deleting periods for a budget (the delete cascade).
 *
 * Period GENERATION (prime/non-prime allocation from source_periods) remains
 * owned by the existing budget period engine and is invoked from the create
 * cascade job — it is intentionally not reimplemented here.
 *
 * @module repositories/budget_period
 */
import { TraceContext, WriteResult } from "../types";
import { BudgetPeriodEntity } from "../types/budgets/budget_entity.types";
/**
 * Budget Period Repository.
 */
export declare const budget_period_repo: {
    /**
     * Returns the document IDs of all periods for a budget.
     * Used by the delete resolver to size the cascade.
     */
    get_ids_by_budget_id(_ctx: TraceContext, budget_id: string): Promise<string[]>;
    /**
     * Returns all periods for a budget as entities.
     */
    get_by_budget_id(_ctx: TraceContext, budget_id: string): Promise<BudgetPeriodEntity[]>;
    /**
     * Gets the raw doc data + id for a set of period IDs (missing docs skipped).
     * READ-ONLY — used by the summary resolver to group periods for recompute.
     */
    get_by_ids(_ctx: TraceContext, period_ids: string[]): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    /**
     * Hard-deletes all periods for a budget in batches (max 500 per batch).
     * Returns one WriteResult per deleted period.
     */
    delete_by_budget_id(_ctx: TraceContext, budget_id: string): Promise<WriteResult[]>;
    /**
     * Hard-deletes periods by document ID in batches (max 500 per batch).
     */
    delete_by_ids(_ctx: TraceContext, ids: string[]): Promise<WriteResult[]>;
    /**
     * Batch-saves generated budget periods (max 500 per batch).
     * Maps each entity to the legacy budget_periods document, defaulting the
     * fields the rest of the system reads (denormalized name, checklist, flags).
     *
     * @param ctx - Trace context
     * @param periods - Period entities to persist
     * @param budget_name - Denormalized budget name to store on each period
     */
    save_batch(_ctx: TraceContext, periods: BudgetPeriodEntity[], budget_name: string): Promise<WriteResult[]>;
    /**
     * Recomputes SPENT fields IN PLACE on existing periods (max 500 per batch).
     * Used by the spend pipeline (invalidation-based): writes `spent`,
     * `pendingSpent`, and `remaining` while preserving everything else on the
     * period (allocation, notes, checklist, etc.). NOT an increment.
     */
    update_spent(_ctx: TraceContext, updates: Array<{
        id: string;
        spent: number;
        pending_spent: number;
        remaining: number;
    }>): Promise<WriteResult[]>;
    /**
     * Updates allocation fields IN PLACE on existing periods (max 500 per batch).
     * Used when a budget's amount changes: recomputes allocatedAmount /
     * originalAmount / remaining / dailyRate while preserving everything else on
     * the period (userNotes, checklistItems, modifiedAmount, spent, etc.).
     */
    update_allocations(_ctx: TraceContext, updates: Array<{
        id: string;
        allocated_amount: number;
        daily_rate: number;
        remaining: number;
        is_prime?: boolean;
        prime_period_ids?: string[];
        prime_period_breakdown?: BudgetPeriodEntity["prime_period_breakdown"];
    }>): Promise<WriteResult[]>;
    /**
     * Updates the denormalized budgetName on the given periods (max 500 per
     * batch). Used when a budget is renamed. Preserves all other period fields.
     */
    update_names(_ctx: TraceContext, period_ids: string[], budget_name: string): Promise<WriteResult[]>;
    /**
     * Counts periods for a budget.
     */
    count_by_budget_id(_ctx: TraceContext, budget_id: string): Promise<number>;
};
//# sourceMappingURL=budget_period.repo.d.ts.map