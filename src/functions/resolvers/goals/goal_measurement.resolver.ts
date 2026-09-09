/**
 * Goal Measurement Resolver — Goals (Phase 1)
 *
 * Read-only. For a viewed period, computes each active goal's per-period progress
 * from balance snapshots, attributing a shared account's movement across its
 * goals by priority order (fill the top-ranked goal's target first).
 *
 * Direction is goal-type-aware: save/purchase/invest measure the account balance
 * GROWING; debt_paydown measures the liability balance DROPPING.
 *
 * The pure shaping (met / target_reached / rounding) is delegated to the domain
 * service; this resolver only reads + attributes.
 *
 * @module resolvers/goals/goal_measurement
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { GoalEntity, GoalMeasurement } from "../../types/goals/goal_entity.types";
import { goal_repo } from "../../repositories/goal.repo";
import { balance_snapshot_repo } from "../../repositories/balance_snapshot.repo";
import {
  amount_for_span,
  compute_goal_measurement,
} from "../../domain/goals/goal.service";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GoalMeasurementView {
  goal: GoalEntity;
  measurement: GoalMeasurement;
}

function is_debt(g: GoalEntity): boolean {
  return g.goal_type === "debt_paydown";
}

/** Priority-fill a pool across goals (sorted by priority_rank asc). */
function allocate_by_priority(
  pool: number,
  goals_sorted: GoalEntity[],
  target_of: (g: GoalEntity) => number
): Map<string, number> {
  const out = new Map<string, number>();
  let remaining = Math.max(0, pool);
  for (const g of goals_sorted) {
    const target = Math.max(0, target_of(g));
    const allocated = Math.min(remaining, target);
    out.set(g.id, allocated);
    remaining -= allocated;
  }
  return out;
}

export async function resolve_goal_measurements(
  ctx: TraceContext,
  user_id: string,
  period_id: string,
  period_start: Timestamp,
  period_end: Timestamp
): Promise<GoalMeasurementView[]> {
  const goals = await goal_repo.get_by_user(ctx, user_id);
  if (goals.length === 0) return [];

  const span_days = Math.max(
    1,
    (period_end.toMillis() - period_start.toMillis()) / DAY_MS
  );

  const target_for = (g: GoalEntity): number =>
    amount_for_span(g.per_period_amount, g.home_cadence, span_days);

  // Group by watched account so partition + one snapshot read happens per account.
  const by_account = new Map<string, GoalEntity[]>();
  for (const g of goals) {
    const list = by_account.get(g.linked_account_id) ?? [];
    list.push(g);
    by_account.set(g.linked_account_id, list);
  }

  const views: GoalMeasurementView[] = [];

  for (const [account_id, account_goals] of by_account.entries()) {
    const start_snap = await balance_snapshot_repo.get_at_or_before(
      account_id,
      period_start
    );
    const end_snap = await balance_snapshot_repo.get_at_or_before(
      account_id,
      period_end
    );

    const data_incomplete = !start_snap || !end_snap;
    const gain =
      start_snap && end_snap
        ? end_snap.currentBalance - start_snap.currentBalance
        : 0;
    const latest_balance =
      end_snap?.currentBalance ?? start_snap?.currentBalance ?? null;

    // Attribute the account's movement per direction, by priority.
    const save_goals = account_goals
      .filter((g) => !is_debt(g))
      .sort((a, b) => a.priority_rank - b.priority_rank);
    const debt_goals = account_goals
      .filter(is_debt)
      .sort((a, b) => a.priority_rank - b.priority_rank);

    const save_alloc = allocate_by_priority(
      Math.max(0, gain),
      save_goals,
      target_for
    );
    const debt_alloc = allocate_by_priority(
      Math.max(0, -gain),
      debt_goals,
      target_for
    );

    for (const g of account_goals) {
      const allocated =
        (is_debt(g) ? debt_alloc.get(g.id) : save_alloc.get(g.id)) ?? 0;

      const latest = latest_balance ?? g.baseline_balance;
      const cumulative = is_debt(g)
        ? g.baseline_balance - latest // liability dropping = progress
        : g.baseline_counts_existing
          ? latest
          : latest - g.baseline_balance;

      const measurement = compute_goal_measurement({
        goal_id: g.id,
        period_id,
        target_for_period: target_for(g),
        attributed_progress: allocated,
        cumulative_progress: cumulative,
        target_amount: g.target_amount,
        data_incomplete,
      });

      views.push({ goal: g, measurement });
    }
  }

  return views;
}
