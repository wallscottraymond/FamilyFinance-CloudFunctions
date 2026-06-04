/**
 * Assign Transaction Orchestrator
 *
 * The Transaction Assignment Engine's IO shell. Coordinates:
 *   resolver (load context once) → compute_transaction_assignment (pure core)
 *   → skip-if-unchanged → single write of the split assignment (+ splitBudgetIds)
 *   → scoped fan-out (recompute touched budgets).
 *
 * The engine is the SINGLE writer of split assignment fields. Per-split decisions
 * are logged for "why did this land in Everything Else?" troubleshooting.
 *
 * NOTE: the `recompute_budget_spent` fan-out job's handler ships with the
 * Budget-Transaction-Spend-Pipeline sub-project; until then the job is enqueued
 * and harmlessly ignored by `on_job_created`.
 *
 * @module orchestrators/transactions/assign_transaction
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import {
  resolve_assignment_context,
} from "../../resolvers/transactions/assignment_context.resolver";
import {
  compute_transaction_assignment,
} from "../../domain/transactions/compute_transaction_assignment.service";
import { transaction_repo } from "../../repositories/transaction.repo";

/** Input: assign all splits of one transaction. */
export interface AssignTransactionInput {
  user_id: string;
  transaction_id: string;
}

/** Result (also handy for tests). */
export interface AssignTransactionResult {
  found: boolean;
  changed: boolean;
  /** Budgets whose spent may have changed (before ∪ after) — the fan-out scope. */
  touched_budget_ids: string[];
  assigned_splits: number;
}

/**
 * Assign a transaction's splits.
 */
export async function assign_transaction_orchestrator(
  ctx: TraceContext,
  input: AssignTransactionInput
): Promise<AssignTransactionResult> {
  const span = create_span(ctx, "orchestrator", "assign_transaction");
  log_operation_start(span, input.user_id);

  try {
    // 1. Resolve context once.
    const resolved = await resolve_assignment_context(
      ctx,
      input.user_id,
      input.transaction_id
    );
    if (!resolved) {
      log_operation_success(span, input.user_id);
      return { found: false, changed: false, touched_budget_ids: [], assigned_splits: 0 };
    }

    // 2. Pure core.
    const result = compute_transaction_assignment(resolved.splits_input, resolved.context);

    // 3. Decision logging: one compact line per split (category + date + the
    //    budget it landed on + why) — enough to answer "why this budget?".
    const cat_by_split = new Map(
      resolved.splits_input.map((s) => [s.split_id, s.plaid_match_category])
    );
    const txn_date_iso = new Date(resolved.context.txn_date_ms)
      .toISOString()
      .slice(0, 10);
    for (const s of result.splits) {
      console.log(
        JSON.stringify({
          severity: "DEBUG",
          message: "split assignment decision",
          trace_id: ctx.trace_id,
          transaction_id: input.transaction_id,
          split_id: s.split_id,
          category: cat_by_split.get(s.split_id) ?? null,
          txn_date: txn_date_iso,
          budget_id: s.budget_id,
          reason: s.reason.budget,
        })
      );
      if (s.reason.tie) {
        console.warn(
          `[assign_transaction] category drift: split ${s.split_id} matched >1 real budget`
        );
      }
    }
    if (result.any_unassigned) {
      console.error(
        `[assign_transaction] no Everything Else budget for user ${input.user_id}` +
          " — split(s) left unassigned"
      );
    }

    // 4. Merge the assignment onto the raw split maps + denormalize the matched
    //    budget's name. `name_changed` heals a drifted `budgetName` (the app
    //    defaults new splits to "General") even when the assignment is unchanged.
    const by_id = new Map(result.splits.map((s) => [s.split_id, s]));
    const now = Timestamp.now();
    let name_changed = false;
    /* eslint-disable @typescript-eslint/naming-convention */
    const updated_splits = resolved.raw_splits.map((raw) => {
      const a = by_id.get(raw.splitId as string);
      if (!a) {
        return raw;
      }
      const budget_name = resolved.budget_names[a.budget_id];
      if (budget_name !== undefined && raw.budgetName !== budget_name) {
        name_changed = true;
      }
      return {
        ...raw,
        budgetId: a.budget_id,
        budgetName: budget_name ?? raw.budgetName,
        budgetAssignmentSource: a.budget_assignment_source,
        outflowId: a.outflow_id,
        inflowId: a.inflow_id,
        monthlyPeriodId: a.monthly_period_id,
        weeklyPeriodId: a.weekly_period_id,
        biWeeklyPeriodId: a.bi_weekly_period_id,
        updatedAt: now,
      };
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    // 5. Skip-if-unchanged (loop prevention). A budgetName-only drift still
    //    writes (display heal) but does NOT fan out a recompute (spend unmoved).
    if (!result.changed && !name_changed) {
      log_operation_success(span, input.user_id);
      return {
        found: true,
        changed: false,
        touched_budget_ids: result.touched_budget_ids,
        assigned_splits: result.splits.length,
      };
    }

    // 6. Single write.
    const split_budget_ids = [...new Set(result.splits.map((s) => s.budget_id))];
    await transaction_repo.apply_split_assignments(
      ctx,
      resolved.transaction_doc_id,
      updated_splits,
      split_budget_ids
    );

    // 7. Scoped fan-out: recompute the touched budgets' spend — only when the
    //    assignment actually changed (a name-only heal doesn't move spend).
    if (result.changed) {
      await create_job(
        "recompute_budget_spent",
        {
          user_id: input.user_id,
          transaction_id: input.transaction_id,
          transaction_date_ms: resolved.context.txn_date_ms,
          budget_ids: result.touched_budget_ids,
        },
        { trace_id: ctx.trace_id }
      );
    }

    log_operation_success(span, input.user_id);
    return {
      found: true,
      changed: result.changed,
      touched_budget_ids: result.touched_budget_ids,
      assigned_splits: result.splits.length,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "ASSIGN_TRANSACTION_FAILED" }
    );
    throw error;
  }
}
