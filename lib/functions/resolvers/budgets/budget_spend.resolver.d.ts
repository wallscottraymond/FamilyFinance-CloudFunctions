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
import { SplitForSpend } from "../../domain/budgets/budget_spend.service";
/**
 * Resolve the spend splits for a (budget, period date range).
 *
 * @returns Every countable-candidate split assigned to `budget_id` in the range.
 */
export declare function resolve_spend_splits(ctx: TraceContext, user_id: string, budget_id: string, start_ms: number, end_ms: number): Promise<SplitForSpend[]>;
//# sourceMappingURL=budget_spend.resolver.d.ts.map