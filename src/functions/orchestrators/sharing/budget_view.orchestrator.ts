/**
 * Budget View Orchestrators (D9, D32, D13; PD6)
 *
 * move_budget: Me ↔ group. The budget keeps its id, settings and periods; its
 *   owner key changes (budget + every period). Moving out of Me re-runs the
 *   assignment engine on the mover's transactions that pointed at it.
 * copy_budgets_to_group: new group budgets with the same settings; originals
 *   stay (or move, with remove_from_me). Clashes come back as conflicts.
 * return_moved_in_budgets: on leave / removal / delete, budgets someone moved
 *   in go back to their Me view.
 *
 * @module orchestrators/sharing/budget_view
 */

import { randomUUID } from "crypto";
import { OrchestratorContext, TraceContext } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
import { Group } from "../../types/sharing.types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  plan_move_budget,
  plan_copy_budgets,
  budgets_returned,
  group_id_of_key,
  group_view_key,
  ViewBudget,
  CopyConflict,
} from "../../domain/sharing/budget_view.service";
import { budget_repo } from "../../repositories/budget.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { group_repo } from "../../repositories/sharing";
import { create_job } from "../../infrastructure/job_queue";
import { create_budget_orchestrator } from "../budgets/create_budget.orchestrator";
import { ensure_group_everything_else } from "./group_everything_else";

/** Repo budget → the fields the view rules need. */
function to_view_budget(b: BudgetEntity | null): ViewBudget | null {
  if (!b) return null;
  return {
    id: b.id,
    owner_key: b.user_id,
    name: b.name,
    amount: b.amount,
    category_ids: b.category_ids ?? [],
    is_everything_else: b.is_system_everything_else === true,
    brought_by: b.brought_by ?? null,
  };
}

async function load_view_budgets(ctx: TraceContext, owner_key: string): Promise<ViewBudget[]> {
  const budgets = await budget_repo.get_by_user_id(ctx, owner_key);
  return budgets.map((b) => to_view_budget(b)!);
}

/** Applies a move: budget + periods re-keyed; the old owner's pinned splits re-assigned. */
async function apply_move(
  ctx: TraceContext,
  budget: ViewBudget,
  new_owner_key: string,
  brought_by: string | null,
  actor_id: string
): Promise<void> {
  const old_owner_key = budget.owner_key;
  const affected =
    group_id_of_key(old_owner_key) === null
      ? await transaction_repo.get_ids_referencing_budget(ctx, old_owner_key, budget.id)
      : [];
  await budget_repo.set_owner(ctx, budget.id, new_owner_key, brought_by, actor_id);
  await budget_period_repo.set_owner_for_budget(ctx, budget.id, new_owner_key);
  if (affected.length > 0) {
    await create_job(
      "assign_transactions_batch",
      { user_id: old_owner_key, transaction_ids: affected },
      { trace_id: ctx.trace_id }
    );
  }
  const to_group = group_id_of_key(new_owner_key);
  if (to_group) await ensure_group_everything_else(ctx, to_group);
}

export interface BudgetViewResult {
  success: boolean;
  errors?: string[];
  budget_ids?: string[];
  conflicts?: CopyConflict[];
}

/** Moves a budget between Me and a group. `to_group_id: null` = to Me. */
export async function move_budget_orchestrator(
  ctx: OrchestratorContext<{ budget_id: string; to_group_id: string | null }>
): Promise<BudgetViewResult> {
  const span = create_span(ctx, "orchestrator", "move_budget");
  log_operation_start(span, ctx.user_id);

  // 1. RESOLVER
  const budget = to_view_budget(await budget_repo.get_by_id(ctx, ctx.input.budget_id));
  const source_gid = budget ? group_id_of_key(budget.owner_key) : null;
  const [source_group, target_group] = await Promise.all([
    source_gid ? group_repo.get(ctx, source_gid) : Promise.resolve(null as Group | null),
    ctx.input.to_group_id
      ? group_repo.get(ctx, ctx.input.to_group_id)
      : Promise.resolve(null as Group | null),
  ]);
  const target_key = ctx.input.to_group_id
    ? group_view_key(ctx.input.to_group_id)
    : ctx.user_id;
  const target_budgets = await load_view_budgets(ctx, target_key);

  // 2. DOMAIN
  const plan = plan_move_budget(
    budget,
    ctx.user_id,
    source_group,
    ctx.input.to_group_id ? { type: "group", group: target_group } : { type: "me" },
    target_budgets
  );
  if (plan.validation_errors?.length || !plan.entity) {
    return { success: false, errors: plan.validation_errors };
  }

  // 3. REPOSITORY
  await apply_move(ctx, budget!, plan.entity.new_owner_key, plan.entity.brought_by, ctx.user_id);

  log_operation_success(span, ctx.user_id);
  return { success: true, budget_ids: [budget!.id] };
}

export interface CopyBudgetsInput {
  group_id: string;
  items: Array<{ budget_id: string; amount: number }>;
  remove_from_me: boolean;
}

/** Copies (or moves) the caller's budgets into a group (D32). */
export async function copy_budgets_to_group_orchestrator(
  ctx: OrchestratorContext<CopyBudgetsInput>
): Promise<BudgetViewResult> {
  const span = create_span(ctx, "orchestrator", "copy_budgets_to_group");
  log_operation_start(span, ctx.user_id);
  const { group_id, items, remove_from_me } = ctx.input;

  // 1. RESOLVER
  const [group, mine, group_budgets] = await Promise.all([
    group_repo.get(ctx, group_id),
    budget_repo.get_by_user_id(ctx, ctx.user_id),
    load_view_budgets(ctx, group_view_key(group_id)),
  ]);
  const by_id = new Map(mine.map((b) => [b.id, b]));

  // 2. DOMAIN
  const plan = plan_copy_budgets(
    group,
    ctx.user_id,
    items.map((i) => ({
      budget: to_view_budget(by_id.get(i.budget_id) ?? null),
      amount: i.amount,
    })),
    group_budgets
  );
  if (plan.validation_errors?.length || !plan.entity) {
    return { success: false, errors: plan.validation_errors };
  }

  // 3. REPOSITORY
  const created: string[] = [];
  for (const { source, amount } of plan.entity.creates) {
    if (remove_from_me) {
      // A move keeps the budget's id, amount and history (the chosen amount only
      // applies to copies; the app shows the current amount when moving).
      await apply_move(ctx, source, group_view_key(group_id), ctx.user_id, ctx.user_id);
      created.push(source.id);
      continue;
    }
    const original = by_id.get(source.id)!;
    const res = await create_budget_orchestrator(ctx, ctx.user_id, randomUUID(), {
      name: original.name,
      description: original.description,
      amount,
      category_ids: original.category_ids,
      period: original.period,
      budget_type: original.budget_type,
      start_date: original.start_date.toDate().toISOString(),
      alert_threshold: original.alert_threshold ?? 80,
      is_shared: false,
      view_group_id: group_id,
      is_ongoing: original.is_ongoing ?? true,
      budget_end_date: original.budget_end_date
        ? original.budget_end_date.toDate().toISOString()
        : undefined,
    });
    created.push(res.budget_id);
  }

  log_operation_success(span, ctx.user_id);
  return { success: true, budget_ids: created, conflicts: plan.entity.conflicts };
}

/**
 * D13: budgets the leaving people moved in go back to their Me view. Called by
 * manage_group (leave / remove / delete) and account purge. Never throws.
 */
export async function return_moved_in_budgets(
  ctx: TraceContext,
  group_id: string,
  leaving: string[] | "all",
  actor_id: string
): Promise<number> {
  try {
    const group_budgets = await load_view_budgets(ctx, group_view_key(group_id));
    const returns = budgets_returned(group_budgets, leaving);
    for (const r of returns) {
      const b = group_budgets.find((x) => x.id === r.budget_id)!;
      await apply_move(ctx, b, r.to_owner_key, null, actor_id);
    }
    return returns.length;
  } catch (error) {
    console.error(
      `[${ctx.trace_id}] return_moved_in_budgets(${group_id}) failed:`,
      error instanceof Error ? error.message : error
    );
    return 0;
  }
}
