/**
 * Budget Domain Service Unit Tests
 *
 * Pure functions — no mocks, no IO. Verifies business rules and determinism.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  count_days_inclusive,
  compute_period_allocation,
  compute_daily_rate,
  compute_period_generation_end,
  compute_reallocated_periods,
  compute_budget_periods,
  budget_amount_per_instance,
  build_self_provision_budget_created_payload,
  prime_daily_rate_on,
} from "../period_generation.service";
import { compute_create_budget } from "../create_budget.service";
import { compute_update_budget } from "../update_budget.service";
import { compute_delete_budget } from "../delete_budget.service";
import { BudgetEntity } from "../../../types/budgets/budget_entity.types";
import { CreateBudgetInput } from "../../../types/budgets/create_budget.types";

const NOW = Timestamp.fromDate(new Date("2026-05-31T00:00:00.000Z"));

function make_create_input(
  overrides: Partial<CreateBudgetInput> = {}
): CreateBudgetInput {
  return {
    name: "Groceries",
    amount: 300,
    category_ids: ["cat_food"],
    period: "monthly",
    budget_type: "recurring",
    start_date: "2026-06-01T00:00:00.000Z",
    alert_threshold: 80,
    is_shared: false,
    is_ongoing: true,
    ...overrides,
  };
}

function make_existing_budget(overrides: Partial<BudgetEntity> = {}): BudgetEntity {
  return {
    id: "budget_1",
    user_id: "user_1",
    group_ids: [],
    is_active: true,
    access: {
      owner_id: "user_1",
      created_by: "user_1",
      group_ids: [],
      is_private: true,
    },
    created_by: "user_1",
    owner_id: "user_1",
    is_private: true,
    name: "Groceries",
    amount: 300,
    currency: "USD",
    category_ids: ["cat_food"],
    period: "monthly",
    budget_type: "recurring",
    start_date: Timestamp.fromDate(new Date("2026-06-01T00:00:00.000Z")),
    end_date: Timestamp.fromDate(new Date("2026-07-01T00:00:00.000Z")),
    spent: 50,
    remaining: 250,
    alert_threshold: 80,
    is_ongoing: true,
    is_system_everything_else: false,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("period_generation.service", () => {
  it("counts inclusive days UTC-normalized", () => {
    const start = new Date("2026-02-01T00:00:00Z");
    const end = new Date("2026-02-28T23:59:59Z");
    expect(count_days_inclusive(start, end)).toBe(28);
  });

  it("allocates 1:1 when cadences match", () => {
    const result = compute_period_allocation({
      budget_amount: 300,
      budget_period_type: "monthly",
      target_start: new Date("2026-06-01T00:00:00Z"),
      target_end: new Date("2026-06-30T00:00:00Z"),
      target_period_type: "monthly",
    });
    expect(result.entity).toBe(300);
  });

  it("allocates a weekly budget to a 7-day target", () => {
    const result = compute_period_allocation({
      budget_amount: 70,
      budget_period_type: "weekly",
      target_start: new Date("2026-06-01T00:00:00Z"),
      target_end: new Date("2026-06-07T00:00:00Z"),
      target_period_type: "monthly",
    });
    expect(result.entity).toBe(70);
  });

  it("uses 6-decimal precision for prime daily rates", () => {
    const result = compute_daily_rate(100, 31, true);
    expect(result.entity).toBeCloseTo(3.225806, 6);
  });

  it("uses 2-decimal precision for non-prime daily rates", () => {
    const result = compute_daily_rate(100, 31, false);
    expect(result.entity).toBe(3.23);
  });

  it("rejects zero period days", () => {
    const result = compute_daily_rate(100, 0, true);
    expect(result.validation_errors).toBeDefined();
  });
});

describe("compute_budget_periods — prime/non-prime breakdown", () => {
  const ts = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));

  // $300/month budget. Two prime monthly periods (June 30d, July 31d) and a
  // weekly period straddling the boundary (Jun 28 – Jul 4).
  const input = {
    budget_id: "b1",
    user_id: "u1",
    group_ids: [],
    budget_amount: 300,
    budget_cadence: "monthly" as const,
    category_ids: [],
    now: NOW,
    source_periods: [
      {
        id: "2026M06",
        period_id: "2026M06",
        period_type: "monthly" as const,
        start_date: ts("2026-06-01T00:00:00Z"),
        end_date: ts("2026-06-30T23:59:59Z"),
      },
      {
        id: "2026M07",
        period_id: "2026M07",
        period_type: "monthly" as const,
        start_date: ts("2026-07-01T00:00:00Z"),
        end_date: ts("2026-07-31T23:59:59Z"),
      },
      {
        id: "2026W27",
        period_id: "2026W27",
        period_type: "weekly" as const,
        start_date: ts("2026-06-28T00:00:00Z"),
        end_date: ts("2026-07-04T23:59:59Z"),
      },
    ],
  };

  it("allocates prime periods 1:1 with a 6-decimal daily rate", () => {
    const { entities } = compute_budget_periods(input);
    const june = entities!.find((e) => e.period_id === "2026M06")!;
    expect(june.is_prime).toBe(true);
    expect(june.allocated_amount).toBe(300);
    expect(june.daily_rate).toBeCloseTo(10, 6); // 300 / 30
    expect(june.prime_period_breakdown).toEqual([]);
  });

  it("derives the non-prime allocation from overlapping prime daily rates", () => {
    const { entities } = compute_budget_periods(input);
    const week = entities!.find((e) => e.period_id === "2026W27")!;
    expect(week.is_prime).toBe(false);
    // 3 days in June @ 10 + 4 days in July @ (300/31)
    const expected = 3 * 10 + 4 * (300 / 31);
    expect(week.allocated_amount).toBeCloseTo(expected, 2);
    expect(week.prime_period_ids).toEqual(["b1_2026M06", "b1_2026M07"]);
  });

  it("builds a per-prime breakdown that accounts for every day", () => {
    const { entities } = compute_budget_periods(input);
    const week = entities!.find((e) => e.period_id === "2026W27")!;
    const bd = week.prime_period_breakdown!;
    expect(bd).toHaveLength(2);
    const total_days = bd.reduce((s, b) => s + b.days_contributed, 0);
    expect(total_days).toBe(7);
    const june = bd.find((b) => b.prime_period_id === "b1_2026M06")!;
    expect(june.days_contributed).toBe(3);
    expect(june.amount_contributed).toBe(30);
    const july = bd.find((b) => b.prime_period_id === "b1_2026M07")!;
    expect(july.days_contributed).toBe(4);
  });

  it("is deterministic", () => {
    expect(compute_budget_periods(input)).toEqual(compute_budget_periods(input));
  });
});

describe("budget_amount_per_instance — quarterly / yearly on the monthly grid (M1-H1)", () => {
  it("monthly / weekly / bi_monthly keep their amount", () => {
    for (const p of ["monthly", "weekly", "bi_monthly", "custom"]) {
      expect(budget_amount_per_instance(300, p)).toBe(300);
    }
  });
  it("a quarterly budget gives each month a third, a yearly one a twelfth", () => {
    expect(budget_amount_per_instance(900, "quarterly")).toBe(300);
    expect(budget_amount_per_instance(1200, "yearly")).toBe(100);
    expect(budget_amount_per_instance(1200, "YEARLY")).toBe(100);
  });
  it("the self-provision payload carries the per-month amount", () => {
    const payload = build_self_provision_budget_created_payload({
      budget_id: "b", user_id: "u", group_ids: [], budget_name: "Gifts", category_ids: [],
      amount: 1200, period: "yearly", start: new Date("2026-06-01T00:00:00Z"),
      is_ongoing: true, budget_end_date: null,
    });
    expect(payload.cadence).toBe("monthly");
    expect(payload.amount).toBe(100);
  });
});

describe("compute_budget_periods — the window's edge months are whole (M1-H3)", () => {
  const ts = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));
  const week = (id: string, start: string, end: string) => ({
    id, period_id: id, period_type: "weekly" as const,
    start_date: ts(`${start}T00:00:00Z`), end_date: ts(`${end}T23:59:59.999Z`),
  });
  // $70/week budget generated from Wed Jun 10 2026: the first week overlapping is Jun 7–13, so
  // June 1–6 has no weekly prime in the input; the window ends mid-July (Jul 5–11 last week).
  const input = {
    budget_id: "b1", user_id: "u1", group_ids: [], budget_amount: 70,
    budget_cadence: "weekly" as const, category_ids: [], now: NOW,
    source_periods: [
      week("2026W24", "2026-06-07", "2026-06-13"),
      week("2026W25", "2026-06-14", "2026-06-20"),
      week("2026W26", "2026-06-21", "2026-06-27"),
      week("2026W27", "2026-06-28", "2026-07-04"),
      week("2026W28", "2026-07-05", "2026-07-11"),
      { id: "2026M06", period_id: "2026M06", period_type: "monthly" as const,
        start_date: ts("2026-06-01T00:00:00Z"), end_date: ts("2026-06-30T23:59:59.999Z") },
      { id: "2026M07", period_id: "2026M07", period_type: "monthly" as const,
        start_date: ts("2026-07-01T00:00:00Z"), end_date: ts("2026-07-31T23:59:59.999Z") },
    ],
  };
  it("every day of the month counts at the weekly rate ($10/day), not only the generated weeks", () => {
    const { entities } = compute_budget_periods(input);
    expect(entities!.find((e) => e.period_id === "2026M06")!.allocated_amount).toBeCloseTo(300, 2);
    expect(entities!.find((e) => e.period_id === "2026M07")!.allocated_amount).toBeCloseTo(310, 2);
  });
  it("the breakdown lists only real prime docs", () => {
    const { entities } = compute_budget_periods(input);
    const june = entities!.find((e) => e.period_id === "2026M06")!;
    expect(june.prime_period_ids).toEqual(["b1_2026W24", "b1_2026W25", "b1_2026W26", "b1_2026W27"]);
    expect(june.prime_period_breakdown!.reduce((n, b) => n + b.days_contributed, 0)).toBe(24);
  });
  it("re-allocation fills the same edge days at the new amount", () => {
    const realloc = compute_reallocated_periods({
      new_amount: 140, budget_cadence: "weekly", cutoff: ts("2026-06-01T00:00:00Z"),
      periods: input.source_periods.map((sp) => ({
        id: sp.id, period_id: sp.period_id, period_type: sp.period_type,
        start_date: sp.start_date, end_date: sp.end_date, spent: 0, rolled_over_amount: 0,
        daily_rate: 10,
      })),
    });
    expect(realloc.entities!.find((u) => u.id === "2026M07")!.allocated_amount).toBeCloseTo(620, 2);
  });
  it("prime_daily_rate_on matches a generated prime for each cadence", () => {
    const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
    expect(prime_daily_rate_on(70, "weekly", d("2026-06-03"))).toBe(10);
    expect(prime_daily_rate_on(310, "monthly", d("2026-07-09"))).toBe(10);
    expect(prime_daily_rate_on(150, "bi_monthly", d("2026-07-15"))).toBe(10); // 1st–15th
    expect(prime_daily_rate_on(160, "bi_monthly", d("2026-07-16"))).toBe(10); // 16th–31st
    expect(prime_daily_rate_on(130, "bi_monthly", d("2026-02-20"))).toBe(10); // 16th–28th
  });
});

describe("compute_period_generation_end", () => {
  const start = new Date("2026-06-01T00:00:00Z");

  it("generates 12 months ahead for ongoing budgets", () => {
    const end = compute_period_generation_end(start, true, null);
    expect(end.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });

  it("uses budget_end_date for limited budgets", () => {
    const limit = new Date("2026-09-30T00:00:00Z");
    const end = compute_period_generation_end(start, false, limit);
    expect(end.toISOString()).toBe(limit.toISOString());
  });

  it("falls back to 12 months for limited budgets without an end date", () => {
    const end = compute_period_generation_end(start, false, null);
    expect(end.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  });
});

describe("compute_reallocated_periods", () => {
  const cutoff = Timestamp.fromDate(new Date("2026-06-01T00:00:00Z"));
  const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

  it("reallocates current+future, skips historical, preserves spent in remaining", () => {
    const result = compute_reallocated_periods({
      new_amount: 400,
      budget_cadence: "monthly",
      cutoff,
      periods: [
        // historical (ends before cutoff) — should be skipped
        {
          id: "past",
          period_id: "2026M05",
          period_type: "monthly",
          start_date: ts("2026-05-01T00:00:00Z"),
          end_date: ts("2026-05-31T00:00:00Z"),
          spent: 120,
          rolled_over_amount: 0,
          daily_rate: 9.677419,
        },
        // current/future (ends on/after cutoff) — reallocated
        {
          id: "cur",
          period_id: "2026M06",
          period_type: "monthly",
          start_date: ts("2026-06-01T00:00:00Z"),
          end_date: ts("2026-06-30T00:00:00Z"),
          spent: 50,
          rolled_over_amount: 0,
          daily_rate: 10,
        },
      ],
    });
    expect(result.entities?.map((u) => u.id)).toEqual(["cur"]);
    expect(result.entities?.[0].allocated_amount).toBe(400);
    expect(result.entities?.[0].remaining).toBe(350); // 400 - 50 spent
  });

  it("includes rolled-over amount in remaining", () => {
    const result = compute_reallocated_periods({
      new_amount: 300,
      budget_cadence: "monthly",
      cutoff,
      periods: [
        {
          id: "cur",
          period_id: "2026M06",
          period_type: "monthly",
          start_date: ts("2026-06-01T00:00:00Z"),
          end_date: ts("2026-06-30T00:00:00Z"),
          spent: 20,
          rolled_over_amount: 25,
          daily_rate: 10,
        },
      ],
    });
    expect(result.entities?.[0].remaining).toBe(305); // 300 + 25 - 20
  });

  it("refreshes the non-prime breakdown from the new prime rate", () => {
    const result = compute_reallocated_periods({
      new_amount: 600,
      budget_cadence: "monthly",
      cutoff,
      periods: [
        {
          id: "jun",
          period_id: "2026M06",
          period_type: "monthly",
          start_date: ts("2026-06-01T00:00:00Z"),
          end_date: ts("2026-06-30T23:59:59Z"),
          spent: 0,
          rolled_over_amount: 0,
          daily_rate: 10, // stale (was 300/30); should be recomputed to 20
        },
        {
          id: "wk",
          period_id: "2026W24",
          period_type: "weekly",
          start_date: ts("2026-06-08T00:00:00Z"),
          end_date: ts("2026-06-14T23:59:59Z"),
          spent: 0,
          rolled_over_amount: 0,
          daily_rate: 2.33, // stale
        },
      ],
    });
    const prime = result.entities?.find((u) => u.id === "jun")!;
    expect(prime.daily_rate).toBeCloseTo(20, 6); // 600 / 30
    const week = result.entities?.find((u) => u.id === "wk")!;
    // 7 days entirely within June at the new $20/day rate.
    expect(week.allocated_amount).toBeCloseTo(140, 2);
    expect(week.prime_period_ids).toEqual(["jun"]);
    expect(week.prime_period_breakdown).toHaveLength(1);
    expect(week.prime_period_breakdown?.[0].days_contributed).toBe(7);
  });
});

describe("compute_create_budget", () => {
  // Code-Health-Review M5-H1 / M1-H1: quarterly / yearly were refused (batch 1) until generation
  // allocated them per month (batch 6, `budget_amount_per_instance`); every cadence is accepted.
  const deps = {
    currency: "USD",
    group_ids: [],
    existing_budget_count: 0,
    everything_else_budget_id: "everything_else",
    view_budgets: [],
    first_by_category: {},
  };
  it.each(["weekly", "monthly", "bi_monthly", "quarterly", "yearly"] as const)("accepts a %s budget", (period) => {
    const result = compute_create_budget({
      budget_id: "b_ok", user_id: "user_1", input: make_create_input({ period }), dependencies: deps, now: NOW,
    });
    expect(result.validation_errors ?? []).toEqual([]);
    expect(result.entity?.period).toBe(period);
  });

  it("creates a valid budget with remaining = amount", () => {
    const result = compute_create_budget({
      budget_id: "budget_new",
      user_id: "user_1",
      input: make_create_input(),
      dependencies: {
        currency: "USD",
        group_ids: [],
        existing_budget_count: 3,
        everything_else_budget_id: "everything_else",
        view_budgets: [],
        first_by_category: {},
      },
      now: NOW,
    });
    expect(result.entity?.remaining).toBe(300);
    expect(result.entity?.spent).toBe(0);
    expect(result.entity?.is_private).toBe(true);
  });

  it("enforces the 50-budget limit", () => {
    const result = compute_create_budget({
      budget_id: "budget_new",
      user_id: "user_1",
      input: make_create_input(),
      dependencies: {
        currency: "USD",
        group_ids: [],
        existing_budget_count: 50,
        everything_else_budget_id: null,
        view_budgets: [],
        first_by_category: {},
      },
      now: NOW,
    });
    expect(result.validation_errors?.join()).toContain("budget limit");
  });

  it("requires a valid budget_end_date when not ongoing", () => {
    const result = compute_create_budget({
      budget_id: "budget_new",
      user_id: "user_1",
      input: make_create_input({ is_ongoing: false }),
      dependencies: {
        currency: "USD",
        group_ids: [],
        existing_budget_count: 0,
        everything_else_budget_id: null,
        view_budgets: [],
        first_by_category: {},
      },
      now: NOW,
    });
    expect(result.validation_errors).toBeDefined();
  });
});

describe("compute_update_budget", () => {
  it("recomputes remaining when amount changes", () => {
    const result = compute_update_budget({
      user_id: "user_1",
      input: { budget_id: "budget_1", amount: 400 },
      dependencies: {
        existing: make_existing_budget(),
        added_category_ids: [],
        removed_category_ids: [],
        everything_else_budget_id: "everything_else",
        amount_changed: true,
        view_budgets: [],
        first_by_category: {},
      },
      now: NOW,
    });
    // existing.spent = 50 → remaining = 350
    expect(result.entity?.remaining).toBe(350);
  });

  it("rejects amount edits on the Everything Else budget", () => {
    const result = compute_update_budget({
      user_id: "user_1",
      input: { budget_id: "ee", amount: 400 },
      dependencies: {
        existing: make_existing_budget({
          id: "ee",
          is_system_everything_else: true,
        }),
        added_category_ids: [],
        removed_category_ids: [],
        everything_else_budget_id: "ee",
        amount_changed: true,
        view_budgets: [],
        first_by_category: {},
      },
      now: NOW,
    });
    expect(result.validation_errors?.join()).toContain("Everything Else");
  });
});

describe("compute_delete_budget", () => {
  it("cannot delete the Everything Else budget", () => {
    const result = compute_delete_budget({
      user_id: "user_1",
      dependencies: {
        existing: make_existing_budget({ is_system_everything_else: true }),
        budget_period_ids: [],
        affected_transaction_ids: [],
        owned_category_ids: [],
        everything_else_budget_id: "ee",
        pending_rollover_by_type: [],
      },
      now: NOW,
    });
    expect(result.validation_errors?.join()).toContain("cannot be deleted");
  });

  it("flags cascade when periods or transactions exist", () => {
    const result = compute_delete_budget({
      user_id: "user_1",
      dependencies: {
        existing: make_existing_budget(),
        budget_period_ids: ["p1", "p2"],
        affected_transaction_ids: ["t1"],
        owned_category_ids: ["cat_food"],
        everything_else_budget_id: "ee",
        pending_rollover_by_type: [],
      },
      now: NOW,
    });
    expect(result.entity?.requires_cascade).toBe(true);
    expect(result.entity?.release_category_ids).toEqual(["cat_food"]);
  });
});
