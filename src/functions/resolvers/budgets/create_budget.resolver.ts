/**
 * Create Budget Resolver
 *
 * READ-ONLY impact analysis for creating a budget. Resolves currency, sharing
 * groups, the user's budget count, current category ownership, and the
 * Everything Else budget. No mutations.
 *
 * @module resolvers/budgets/create_budget
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import {
  CreateBudgetInput,
  CreateBudgetDependencies,
} from "../../types/budgets/create_budget.types";

/**
 * Resolves dependencies for creating a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param input - Normalized create input
 */
export async function resolve_create_budget_dependencies(
  ctx: TraceContext,
  user_id: string,
  input: CreateBudgetInput
): Promise<CreateBudgetDependencies> {
  const span = create_span(ctx, "resolver", "resolve_create_budget_dependencies");
  log_operation_start(span, user_id);

  const db = getFirestore();

  // 1. Resolve currency + family from the user document.
  const user_doc = await db.collection("users").doc(user_id).get();
  const user_data = user_doc.data() ?? {};
  const family_id: string | undefined = user_data.familyId;

  let currency: string = user_data.preferences?.currency ?? "USD";
  let group_ids: string[] = [];

  if (input.is_shared && family_id) {
    group_ids = [family_id];
    const family_doc = await db.collection("families").doc(family_id).get();
    currency = family_doc.data()?.settings?.currency ?? currency;
  } else if (input.group_id) {
    group_ids = [input.group_id];
  }

  // 2. Load the user's active budgets once (limit count + ownership map).
  const budgets = await budget_repo.get_by_user_id(ctx, user_id);
  const existing_budget_count = budgets.length;

  const everything_else =
    budgets.find((b) => b.is_system_everything_else === true) ?? null;

  // 3. Build the ownership map for the requested categories only.
  const category_owners: Record<string, string | null> = {};
  for (const category_id of input.category_ids) {
    category_owners[category_id] = null;
  }
  for (const budget of budgets) {
    if (budget.is_system_everything_else) {
      continue;
    }
    for (const category_id of budget.category_ids) {
      if (category_id in category_owners) {
        category_owners[category_id] = budget.id;
      }
    }
  }

  log_operation_success(span, user_id);

  return {
    currency,
    group_ids,
    existing_budget_count,
    category_owners,
    everything_else_budget_id: everything_else?.id ?? null,
  };
}
