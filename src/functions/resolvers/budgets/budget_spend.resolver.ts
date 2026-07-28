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

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { SplitForSpend } from "../../domain/budgets/budget_spend.service";
import { PeriodInstanceType } from "../../domain/budgets";

/** Which split field carries the budget assignment for each period lens. */
const LENS_FIELD: Record<PeriodInstanceType, string> = {
  monthly: "monthlyBudgetId",
  weekly: "weeklyBudgetId",
  bi_monthly: "biWeeklyBudgetId",
};

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
export async function resolve_spend_splits(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  start_ms: number,
  end_ms: number,
  cadence: PeriodInstanceType = "monthly"
): Promise<SplitForSpend[]> {
  const txns = await transaction_repo.get_active_in_date_range(
    ctx,
    user_id,
    start_ms,
    end_ms
  );

  const lens_field = LENS_FIELD[cadence];
  const out: SplitForSpend[] = [];
  for (const { data: d } of txns) {
    const txn_date_ms = (d.transactionDate as Timestamp).toMillis();
    const is_pending = d.isPending === true;
    const is_transfer = d.type === "transfer";
    const splits = (d.splits as Array<Record<string, unknown>>) ?? [];
    for (const s of splits) {
      // The split's assignment in this budget's lens; monthly falls back to the
      // legacy `budgetId` for pre-migration docs.
      let assigned = s[lens_field] as string | undefined;
      if (assigned === undefined && cadence === "monthly") {
        assigned = s.budgetId as string | undefined;
      }
      if (assigned !== budget_id) {
        continue;
      }
      out.push({
        budget_id,
        amount: (s.amount as number) ?? 0,
        txn_date_ms,
        is_pending,
        is_transfer,
        is_ignored: s.isIgnored === true,
        outflow_id: (s.outflowId as string | null) ?? null,
        inflow_id: (s.inflowId as string | null) ?? null,
      });
    }
  }
  return out;
}
