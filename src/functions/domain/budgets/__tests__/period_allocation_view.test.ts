import {
  bucket_allocation,
  MonthlyPeriodForDerivation,
  rebase_adjustments,
  rebase_reallocated_periods,
  split_adjustment_by_month,
} from "../period_allocation_view.service";

const at = (iso: string): number => Date.parse(iso);
const day = (d: string, end = false): number => at(`${d}T${end ? "23:59:59.999" : "00:00:00"}Z`);

const SEP: MonthlyPeriodForDerivation = {
  allocated_amount: 300, effective_amount: 300, start_ms: day("2031-09-01"), end_ms: day("2031-09-30", true),
};
const OCT: MonthlyPeriodForDerivation = {
  allocated_amount: 310, effective_amount: 320, start_ms: day("2031-10-01"), end_ms: day("2031-10-31", true),
};

describe("bucket_allocation — THE period-page allocation rule", () => {
  it("pro-rates each month's base by overlap days (UTC-inclusive)", () => {
    expect(bucket_allocation([OCT], day("2031-10-01"), day("2031-10-31", true)))
      .toEqual({ allocated: 310, effective: 320 });
    expect(bucket_allocation([OCT], day("2031-10-05"), day("2031-10-11", true)).allocated).toBe(70);
    // straddling: 3 Sept days at 10 + 4 Oct days at 10
    expect(bucket_allocation([SEP, OCT], day("2031-09-28"), day("2031-10-04", true)).allocated)
      .toBe(70);
  });
  it("an adjustment lands wholly on its own period, not on the month's other weeks", () => {
    const oct = {
      ...OCT,
      adjustments: [{ period_id: "2031W41", start_ms: day("2031-10-05"),
        end_ms: day("2031-10-11", true), amount: 50 }],
    };
    expect(bucket_allocation([oct], day("2031-10-05"), day("2031-10-11", true)).allocated).toBe(120);
    expect(bucket_allocation([oct], day("2031-10-12"), day("2031-10-18", true)).allocated).toBe(70);
    expect(bucket_allocation([oct], day("2031-10-01"), day("2031-10-31", true)))
      .toEqual({ allocated: 360, effective: 370 });
    // a bucket overlapping part of the adjusted period gets its day share
    expect(bucket_allocation([oct], day("2031-10-01"), day("2031-10-07", true)).allocated)
      .toBeCloseTo(70 + (50 * 3) / 7, 2);
  });
  it("an adjustment is clipped to its month (a stored part never leaks outside)", () => {
    const oct = {
      ...OCT,
      adjustments: [{ period_id: "2031W40", start_ms: day("2031-09-28"),
        end_ms: day("2031-10-04", true), amount: 40 }],
    };
    // the part counts over Oct 1–4 only (4 days) → all of it in the Oct bucket
    expect(bucket_allocation([SEP, oct], day("2031-10-01"), day("2031-10-31", true)).allocated)
      .toBe(350);
    expect(bucket_allocation([SEP, oct], day("2031-09-01"), day("2031-09-30", true)).allocated)
      .toBe(300);
  });
});

describe("split_adjustment_by_month — cents-exact by overlap days", () => {
  it("one month → one part with the whole amount", () => {
    const parts = split_adjustment_by_month("2031W41", day("2031-10-05"), day("2031-10-11", true),
      49.68, [SEP, OCT]);
    expect(parts).toHaveLength(1);
    expect(parts[0].month_index).toBe(1);
    expect(parts[0].adjustment.amount).toBe(49.68);
  });
  it("straddling → clipped parts by days that sum exactly", () => {
    const parts = split_adjustment_by_month("2031W40", day("2031-09-28"), day("2031-10-04", true),
      10, [SEP, OCT]);
    expect(parts.map((p) => p.adjustment.amount)).toEqual([4.29, 5.71]);
    expect(parts[0].adjustment.end_ms).toBe(SEP.end_ms);
    expect(parts[1].adjustment.start_ms).toBe(OCT.start_ms);
    // and the page shows exactly the amount for the edited week
    const sep = { ...SEP, adjustments: [parts[0].adjustment] };
    const oct = { ...OCT, adjustments: [parts[1].adjustment] };
    expect(bucket_allocation([sep, oct], day("2031-09-28"), day("2031-10-04", true)).allocated)
      .toBe(80);
  });
});

describe("rebase_adjustments — custom periods stay ABSOLUTE when the month's base changes", () => {
  const week = { period_id: "2031W41", start_ms: day("2031-10-05"), end_ms: day("2031-10-11", true) };
  it("the adjusted week shows the same amount before and after (to the cent)", () => {
    for (const [from, to] of [[310, 620], [400, 123.45], [310, 0], [99.99, 1000]]) {
      // week typed $5 under the old base: delta = 5 − round2(from × 7/31)
      const adj = [{ ...week, amount: Math.round((5 - Math.round(from * 7 / 31 * 100) / 100) * 100) / 100 }];
      const before = bucket_allocation([{ ...OCT, allocated_amount: from, adjustments: adj }],
        week.start_ms, week.end_ms).allocated;
      const rebased = rebase_adjustments(adj, from, to, OCT.start_ms, OCT.end_ms);
      const after = bucket_allocation([{ ...OCT, allocated_amount: to, adjustments: rebased }],
        week.start_ms, week.end_ms).allocated;
      expect([from, to, before, after]).toEqual([from, to, 5, 5]);
    }
  });
  it("a whole-month adjustment keeps the month absolute; unchanged base → untouched", () => {
    const month = [{ period_id: "2031M10", start_ms: OCT.start_ms, end_ms: OCT.end_ms, amount: -10 }];
    expect(rebase_adjustments(month, 310, 400, OCT.start_ms, OCT.end_ms)[0].amount).toBe(-100);
    expect(rebase_adjustments(month, 310, 310, OCT.start_ms, OCT.end_ms)).toBe(month);
  });
});

describe("rebase_reallocated_periods — both re-allocation paths", () => {
  const adj = { period_id: "2031W41", start_ms: day("2031-10-05"), end_ms: day("2031-10-11", true), amount: -65 };
  const period = {
    id: "m10", start_ms: OCT.start_ms, end_ms: OCT.end_ms, override: null, allocated_amount: 310,
    adjustments: [adj], rolled_over_amount: 10, spent: 20,
  };
  it("rebases a re-allocated month's adjustments and sets remaining by THE amount rule", () => {
    const [u] = rebase_reallocated_periods([period], [{ id: "m10", allocated_amount: 620, remaining: 0 }]);
    expect(u.period_adjustments![0].amount).toBe(-135); // −65 + 70 − 140
    expect(u.remaining).toBe(620 - 135 + 10 - 20);
  });
  it("a legacy override keeps the base (no rebase); a period without adjustments gets none", () => {
    const [u] = rebase_reallocated_periods([{ ...period, override: 300 }],
      [{ id: "m10", allocated_amount: 620, remaining: 0 }]);
    expect(u.period_adjustments![0].amount).toBe(-65);
    expect(u.remaining).toBe(300 - 65 + 10 - 20);
    const [v] = rebase_reallocated_periods([{ ...period, adjustments: [] }],
      [{ id: "m10", allocated_amount: 620, remaining: 0 }]);
    expect(v.period_adjustments).toBeUndefined();
  });
});

describe("rebase_adjustments — OVERLAPPING custom periods are solved together", () => {
  const APR_S = day("2031-04-01");
  const APR_E = day("2031-04-30", true);
  const page = (base: number, adjustments: Parameters<typeof rebase_adjustments>[0], s: number, e: number) =>
    bucket_allocation([{ allocated_amount: base, effective_amount: base, start_ms: APR_S, end_ms: APR_E, adjustments }], s, e).allocated;
  const WEEK_S = day("2031-04-06");
  const WEEK_E = day("2031-04-12", true);
  const HALF_E = day("2031-04-15", true);

  it("a custom month + a custom week inside it keep BOTH page figures when the base changes", () => {
    // April $300; month set to $400 (adj +100); then the week Apr 6–12 set to $50.
    const week_before = page(300, [{ period_id: "M", start_ms: APR_S, end_ms: APR_E, amount: 100 }], WEEK_S, WEEK_E);
    const adj = [
      { period_id: "M", start_ms: APR_S, end_ms: APR_E, amount: 100 },
      { period_id: "W", start_ms: WEEK_S, end_ms: WEEK_E, amount: Math.round((50 - week_before) * 100) / 100 },
    ];
    const week = page(300, adj, WEEK_S, WEEK_E);
    const month = page(300, adj, APR_S, APR_E);
    expect(week).toBeCloseTo(50, 2);
    for (const to of [600, 150, 0, 301.37]) {
      const rebased = rebase_adjustments(adj, 300, to, APR_S, APR_E);
      expect(page(to, rebased, WEEK_S, WEEK_E)).toBeCloseTo(week, 2)
      expect(page(to, rebased, APR_S, APR_E)).toBeCloseTo(month, 2);
    }
  });

  it("a half-month and a week overlapping it", () => {
    const adj = [
      { period_id: "H", start_ms: APR_S, end_ms: HALF_E, amount: 40 },
      { period_id: "W", start_ms: WEEK_S, end_ms: WEEK_E, amount: -12.5 },
    ];
    const before = [page(300, adj, APR_S, HALF_E), page(300, adj, WEEK_S, WEEK_E)];
    const rebased = rebase_adjustments(adj, 300, 640, APR_S, APR_E);
    expect(page(640, rebased, APR_S, HALF_E)).toBeCloseTo(before[0], 2);
    expect(page(640, rebased, WEEK_S, WEEK_E)).toBeCloseTo(before[1], 2);
  });
});
