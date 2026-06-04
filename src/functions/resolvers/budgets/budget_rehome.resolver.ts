/**
 * Budget Re-home Resolver
 *
 * READ-ONLY: when a budget gains/loses category ownership (create or update),
 * find the existing transactions whose splits are currently assigned to one of
 * the budgets whose membership changed — i.e. the candidates to re-run through
 * the assignment engine so their spend moves (Everything Else ⇄ the budget).
 *
 * Scoped to the budget's date range (the only range where a split could now
 * match it) via the `transactions(userId, transactionDate)` composite index +
 * an in-memory filter on the split assignment (splits aren't queryable by an
 * inner field).
 *
 * @module resolvers/budgets/budget_rehome
 */

import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { budget_repo } from "../../repositories/budget.repo";

/**
 * Resolve the Everything Else budget id: trust the payload hint when present
 * (the create/update resolver only sets it on a formal category claim), else
 * look it up. Keeps the EE impact-analysis read in the resolver layer.
 */
async function resolve_everything_else_id(
  ctx: TraceContext,
  user_id: string,
  ee_hint: string | null
): Promise<string | null> {
  if (ee_hint) {
    return ee_hint;
  }
  const ee = await budget_repo.find_everything_else(ctx, user_id);
  return ee?.id ?? null;
}

/**
 * Re-home targets after a budget is CREATED: existing transactions on Everything
 * Else within the new budget's range may now match it. Returns [] when there's
 * no EE, or this IS the EE budget (self-provision).
 */
export async function resolve_created_rehome_transaction_ids(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  ee_hint: string | null,
  start_ms: number,
  end_ms: number
): Promise<string[]> {
  const ee_id = await resolve_everything_else_id(ctx, user_id, ee_hint);
  if (!ee_id || ee_id === budget_id) {
    return [];
  }
  return resolve_rehome_transaction_ids(ctx, user_id, [ee_id], start_ms, end_ms);
}

/**
 * Re-home targets after a budget's categories are UPDATED: candidates are the
 * transactions currently on this budget (may release back to EE) or on EE (may
 * gain this budget). Returns [] when no categories changed.
 */
export async function resolve_updated_rehome_transaction_ids(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  ee_hint: string | null,
  categories_changed: boolean,
  start_ms: number,
  end_ms: number
): Promise<string[]> {
  if (!categories_changed) {
    return [];
  }
  const ee_id = await resolve_everything_else_id(ctx, user_id, ee_hint);
  const match_budget_ids = ee_id ? [budget_id, ee_id] : [budget_id];
  return resolve_rehome_transaction_ids(
    ctx,
    user_id,
    match_budget_ids,
    start_ms,
    end_ms
  );
}

/**
 * Resolve the transaction IDs to re-assign after a budget's categories change.
 *
 * @param match_budget_ids - Re-home transactions with a split on ANY of these
 *   (e.g. [everything_else] on create; [everything_else, budget] on update).
 * @param start_ms - Budget coverage window start (inclusive).
 * @param end_ms - Budget coverage window end (inclusive).
 */
export async function resolve_rehome_transaction_ids(
  ctx: TraceContext,
  user_id: string,
  match_budget_ids: string[],
  start_ms: number,
  end_ms: number
): Promise<string[]> {
  if (match_budget_ids.length === 0) {
    return [];
  }
  const match = new Set(match_budget_ids);
  const txns = await transaction_repo.get_active_in_date_range(
    ctx,
    user_id,
    start_ms,
    end_ms
  );

  const ids: string[] = [];
  for (const { id, data: d } of txns) {
    const split_budget_ids =
      (d.splitBudgetIds as string[] | undefined) ??
      ((d.splits as Array<Record<string, unknown>> | undefined) ?? [])
        .map((s) => s.budgetId as string | undefined)
        .filter((id): id is string => !!id);
    if (split_budget_ids.some((bid) => match.has(bid))) {
      ids.push(id);
    }
  }

  console.log(
    `[${ctx.trace_id}] resolve_rehome_transaction_ids: user=${user_id}, ` +
      `candidates=${ids.length} (of ${txns.length} in range)`
  );
  return ids;
}
