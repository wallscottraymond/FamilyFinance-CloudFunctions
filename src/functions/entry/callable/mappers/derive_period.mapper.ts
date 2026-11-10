/**
 * derive_period response mapper — the ONE mapping from a derived period result to the client
 * wire format. Shared by `derive_period` and `derive_period_range` so both return identical
 * shapes (the mobile `periodDeriveService` cache stores either interchangeably).
 *
 * @module entry/callable/mappers/derive_period.mapper
 */

import {
  DerivedBudgetResult,
  DerivedRecurringResult,
  DerivePeriodResult,
} from "../../../domain/periods/period_view.service";

// Client wire format (camelCase, consumed as-is by the mobile app).
/* eslint-disable @typescript-eslint/naming-convention */

function map_budget(b: DerivedBudgetResult) {
  return {
    budgetId: b.budget_id,
    name: b.name,
    isEverythingElse: b.is_everything_else,
    isFund: b.is_fund === true,
    // User-facing first_category slugs the budget owns ([] for Everything Else / manual budgets).
    firstCategoryIds: b.first_category_ids ?? [],
    periods: b.periods.map((p) => ({
      periodId: p.period_id,
      periodType: p.period_type,
      allocatedAmount: p.allocated_amount,
      effectiveAmount: p.effective_amount,
      spent: p.spent,
      // Per UTC day of the period (index 0 = first day); sums to `spent` (budget daily chart).
      dailySpent: p.daily_spent ?? [],
      // "Easy to change" tips — from the same counted splits as `spent`.
      dailyCount: p.daily_count ?? [],
      places: (p.places ?? []).map((pl) => ({
        key: pl.key, name: pl.name, count: pl.count, smallCount: pl.small_count, total: pl.total,
      })),
      fees: p.fees ?? [],
      returnAmount: p.return_amount,
      remaining: p.remaining,
      isDerived: true,
      // Everything-Else only: no expected income → FE prompts instead of a negative.
      noIncome: p.no_income ?? false,
      // Budget pause (Code-Health-Review PZ3/PZ5): every day paused → "Paused" (sorted last);
      // some → "Partly paused". Paused days' spending is in Everything Else.
      isPaused: p.is_paused ?? false,
      pausedDays: p.paused_days ?? 0,
      ...(p.fund_total !== undefined ? { fundTotal: p.fund_total, fundSpentToDate: p.fund_spent_to_date } : {}),
    })),
  };
}
function map_recurring(r: DerivedRecurringResult) {
  return {
    recurringId: r.recurring_id,
    name: r.name,
    groups: r.groups.map((g) => ({
      periodId: g.period_id,
      countInPeriod: g.count_in_period,
      countPaid: g.count_paid,
      totalDue: g.total_due,
      totalPaid: g.total_paid,
      totalUnpaid: g.total_unpaid,
      isDuePeriod: g.is_due_period,
      ...(g.paused_until_ms !== undefined ? { pausedUntilMs: g.paused_until_ms } : {}),
      isFullyPaid: g.is_fully_paid,
      status: g.status,
      occurrences: g.occurrences.map((o) => ({
        dueMs: o.due_ms,
        paid: o.paid,
        amount: o.amount,
        ...(o.expected_amount !== undefined ? { expectedAmount: o.expected_amount } : {}),
        // Settled by "Mark as paid / received" (no transaction) — the detail screen's undo.
        ...(o.manual ? { manual: true } : {}),
        // The transaction that paid it (doc id) — the detail screen opens it.
        ...(o.transaction_id ? { transactionId: o.transaction_id } : {}),
      })),
      firstDueMs: g.first_due_ms,
      nextUnpaidDueMs: g.next_unpaid_due_ms,
    })),
    // Group views only: whose bill/income it is (owner badge). Omitted in Me.
    ...(r.owner_user_id ? { ownerUserId: r.owner_user_id } : {}),
  };
}

/** Client wire format for one derived period (`derive_period`'s `data`). */
export function map_derive_period_result(result: DerivePeriodResult) {
  return {
    viewCadence: result.view_cadence,
    budgets: result.budgets.map(map_budget),
    bills: result.bills.map(map_recurring),
    income: result.income.map(map_recurring),
  };
}
