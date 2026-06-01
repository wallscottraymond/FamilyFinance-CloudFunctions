/**
 * Delete Budget Resolver
 *
 * READ-ONLY impact analysis for deleting a budget. Loads the budget, its
 * periods, the transactions whose splits reference it (for reassignment), the
 * categories it owns, and the Everything Else budget. No mutations.
 *
 * Transactions are found the same way as the legacy delete: scan the user's
 * active transactions and filter splits in memory (splits are nested, so they
 * cannot be queried directly). The cascade job re-queries authoritatively.
 *
 * @module resolvers/budgets/delete_budget
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { NotFoundError } from "../../types/errors";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { DeleteBudgetDependencies } from "../../types/budgets/delete_budget.types";

/**
 * Resolves dependencies for deleting a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the delete
 * @param budget_id - Budget being deleted
 * @throws NotFoundError if the budget does not exist
 */
export async function resolve_delete_budget_dependencies(
  ctx: TraceContext,
  user_id: string,
  budget_id: string
): Promise<DeleteBudgetDependencies> {
  const span = create_span(ctx, "resolver", "resolve_delete_budget_dependencies");
  log_operation_start(span, user_id);

  const existing = await budget_repo.get_by_id(ctx, budget_id);
  if (!existing) {
    throw new NotFoundError("budget", budget_id);
  }

  const [budget_period_ids, affected_transaction_ids, everything_else] =
    await Promise.all([
      budget_period_repo.get_ids_by_budget_id(ctx, budget_id),
      find_transactions_referencing_budget(ctx, user_id, budget_id),
      budget_repo.find_everything_else(ctx, user_id),
    ]);

  log_operation_success(span, user_id);

  return {
    existing,
    budget_period_ids,
    affected_transaction_ids,
    owned_category_ids: existing.category_ids,
    everything_else_budget_id: everything_else?.id ?? null,
  };
}

/**
 * Finds active transactions with at least one split referencing the budget.
 * Queries by both ownerId and userId (legacy compatibility) and dedupes.
 */
async function find_transactions_referencing_budget(
  _ctx: TraceContext,
  user_id: string,
  budget_id: string
): Promise<string[]> {
  const db = getFirestore();

  const [owner_snap, user_snap] = await Promise.all([
    db
      .collection("transactions")
      .where("ownerId", "==", user_id)
      .where("isActive", "==", true)
      .get(),
    db
      .collection("transactions")
      .where("userId", "==", user_id)
      .where("isActive", "==", true)
      .get(),
  ]);

  const matched = new Set<string>();
  for (const snap of [owner_snap, user_snap]) {
    snap.docs.forEach((doc) => {
      /* eslint-disable @typescript-eslint/naming-convention */
      const splits = (doc.data().splits ?? []) as Array<{ budgetId?: string }>;
      /* eslint-enable @typescript-eslint/naming-convention */
      if (splits.some((s) => s.budgetId === budget_id)) {
        matched.add(doc.id);
      }
    });
  }

  return Array.from(matched);
}
