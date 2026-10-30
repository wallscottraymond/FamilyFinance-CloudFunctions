/**
 * Budget Spend Resolver
 *
 * READ-ONLY: gather the transaction splits assigned to a budget within a period's
 * date range, mapped to the spend domain's input. Uses a `transactionDate` range
 * query (top-level, indexable) + an in-memory filter on `split.budgetId` — the
 * splits-read constraint (splits are an array of maps and can't be queried by an
 * inner field). Bounded to one period's transactions.
 *
 * Composite index required: `transactions(userId ASC, transactionDate ASC)`.
 *
 * @module resolvers/budgets/budget_spend
 */
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { SplitForSpend } from "../../domain/budgets/budget_spend.service";
import { load_category_catalog } from "../shared/category_catalog.resolver";
import { PeriodInstanceType } from "../../domain/budgets";
/** Active transactions in a window (what `transaction_repo.get_active_in_date_range` returns). */
export type WindowTxns = Awaited<ReturnType<typeof transaction_repo.get_active_in_date_range>>;
/**
 * Per-call memo of window transaction loads. A single recompute touches several budgets whose
 * periods share IDENTICAL date windows (every budget's monthly period is the same month), so
 * each window is read once instead of once per budget. Exact-window keyed → identical results.
 */
export declare function create_window_txn_loader(ctx: TraceContext, user_id: string, 
/** One read of the user's transactions covering [lo_ms, hi_ms]: any window inside it is sliced
 *  from memory instead of read (a convert touches ~100 windows of one year). Windows outside
 *  it fall back to the per-window read. Same rows, same order. */
preloaded?: {
    lo_ms: number;
    hi_ms: number;
    txns: WindowTxns;
}): (start_ms: number, end_ms: number) => Promise<WindowTxns>;
/**
 * Resolve the spend splits for a (budget, period date range).
 *
 * Per-Period-EE: a split is assigned INDEPENDENTLY per lens, so we match the split
 * field for THIS budget's cadence (`cadence` = the budget's own `period`, applied
 * to all its periods — prime and non-prime). Pre-migration docs only have the
 * legacy `budgetId` (= the monthly assignment), so the monthly lens falls back to
 * it; weekly/bi_monthly match only their own field.
 *
 * @returns Every countable-candidate split assigned to `budget_id` in the range.
 */
export declare function resolve_spend_splits(ctx: TraceContext, user_id: string, budget_id: string, start_ms: number, end_ms: number, cadence?: PeriodInstanceType, load_txns?: (start_ms: number, end_ms: number) => Promise<WindowTxns>): Promise<SplitForSpend[]>;
/**
 * One STORED split → the spend domain's input for `budget_id` in `cadence`'s lens, or null when
 * the split isn't stored in that budget. PURE — the stored half of "stored == derived" (the
 * property test runs it against the engine and the period page).
 */
export declare function stored_split_for_spend(s: Record<string, unknown>, txn: Record<string, unknown>, budget_id: string, cadence: PeriodInstanceType, catalog: Awaited<ReturnType<typeof load_category_catalog>>, t: {
    txn_date_ms: number;
    is_pending: boolean;
    is_transfer: boolean;
    is_income: boolean;
}): SplitForSpend | null;
//# sourceMappingURL=budget_spend.resolver.d.ts.map