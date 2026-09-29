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
    periods: b.periods.map((p) => ({
      periodId: p.period_id,
      periodType: p.period_type,
      allocatedAmount: p.allocated_amount,
      effectiveAmount: p.effective_amount,
      spent: p.spent,
      returnAmount: p.return_amount,
      remaining: p.remaining,
      isDerived: true,
      // Everything-Else only: no expected income → FE prompts instead of a negative.
      noIncome: p.no_income ?? false,
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
      isFullyPaid: g.is_fully_paid,
      status: g.status,
      occurrences: g.occurrences.map((o) => ({
        dueMs: o.due_ms,
        paid: o.paid,
        amount: o.amount,
      })),
      firstDueMs: g.first_due_ms,
      nextUnpaidDueMs: g.next_unpaid_due_ms,
    })),
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
