/**
 * Everything-Else Leftover — the EE budget's LIMIT is the derived, unallocated
 * cash you have left to spend for a period:
 *
 *   EE_limit = expected income − bills due − goal set-aside − Σ other budgets' allocated
 *
 * (per viewed cadence; zero-based-budgeting remainder). PURE — no IO.
 * See FamilyFinanceObsidian/1 Projects/Everything-Else-Leftover-Limit.md.
 *
 * @module domain/budgets/everything_else_leftover
 */

import { amount_for_span } from "../goals/goal.service";
import { GoalCadence } from "../../types/goals/goal_entity.types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** An active, income-drawing goal's planned set-aside inputs. */
export interface GoalForLeftover {
  per_period_amount: number;
  home_cadence: GoalCadence;
}

/** Per-bucket inputs (all already computed at the viewed-cadence level). */
export interface EELeftoverBucketInputs {
  period_id: string;
  start_ms: number;
  end_ms: number;
  /** Expected income placed in this period (recurring streams; excludes surprise "other income"). */
  expected_income: number;
  /** Bills due in this period (total due, paid or not). */
  bills_due: number;
  /** Σ of the non-EE budgets' allocated amount for this period. */
  other_budgets_allocated: number;
}

export interface EELeftover {
  /** income − bills − goals − other budgets, for the period (may be negative = over-allocated). */
  leftover: number;
  /** True when the period has expected income (else the FE prompts to add income). */
  has_income: boolean;
}

/**
 * Compute the Everything-Else leftover per view bucket. PURE.
 *
 * Goals are translated to each bucket's day-span (`amount_for_span`), consistent
 * with how budgets pro-rate across cadences. A negative leftover means the user
 * has committed more than their expected income (over-allocated) — surfaced as-is.
 */
export function compute_ee_leftovers(
  buckets: EELeftoverBucketInputs[],
  goals: GoalForLeftover[]
): Map<string, EELeftover> {
  const out = new Map<string, EELeftover>();
  for (const b of buckets) {
    const span_days = Math.max(1, (b.end_ms - b.start_ms) / DAY_MS);
    const goal_draws = goals.reduce(
      (sum, g) => sum + amount_for_span(g.per_period_amount, g.home_cadence, span_days),
      0
    );
    const leftover = round2(
      b.expected_income - b.bills_due - goal_draws - b.other_budgets_allocated
    );
    out.set(b.period_id, { leftover, has_income: b.expected_income > 0 });
  }
  return out;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
