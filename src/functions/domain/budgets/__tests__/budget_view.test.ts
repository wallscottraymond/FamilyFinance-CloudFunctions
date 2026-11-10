/**
 * budget_view Domain Service — Unit Tests
 *
 * Verifies derive-on-read for non-monthly budget views:
 *  - spent is the same windowed sum as the stored path (re-bucketed by date)
 *  - allocated/effective are pro-rated from the overlapping monthly period(s)
 *  - remaining = pro-rated effective − spent (rollover folded via effective)
 *  - buckets spanning a month boundary sum both months' daily contributions
 *  - a full month's weekly buckets reconstruct (≈) the month's allocation
 */

import {
  derive_budget_view_periods,
  MonthlyPeriodForDerivation,
  ViewBucket,
} from "../budget_view.service";
import { SplitForSpend } from "../budget_spend.service";

const BUDGET = "b1";

// June 2026 has 30 days.
const JUN_01 = Date.UTC(2026, 5, 1);
const JUN_30 = Date.UTC(2026, 5, 30, 23, 59, 59);
// A clean 7-day week fully inside June (Jun 8–14).
const JUN_08 = Date.UTC(2026, 5, 8);
const JUN_14 = Date.UTC(2026, 5, 14, 23, 59, 59);
const JUN_10 = Date.UTC(2026, 5, 10);
// A week straddling the June/July boundary (Jun 29 – Jul 5).
const JUN_29 = Date.UTC(2026, 5, 29);
const JUL_05 = Date.UTC(2026, 6, 5, 23, 59, 59);
const JUL_01 = Date.UTC(2026, 6, 1);
const JUL_31 = Date.UTC(2026, 6, 31, 23, 59, 59);

/** $600/month, no rollover → daily 20.00. */
function junMonthly(
  over: Partial<MonthlyPeriodForDerivation> = {}
): MonthlyPeriodForDerivation {
  return {
    allocated_amount: 600,
    effective_amount: 600,
    start_ms: JUN_01,
    end_ms: JUN_30,
    ...over,
  };
}

function split(over: Partial<SplitForSpend> = {}): SplitForSpend {
  return {
    budget_id: BUDGET,
    amount: 100,
    txn_date_ms: JUN_10,
    is_pending: false,
    is_transfer: false,
    is_income: false,
    is_income_category: false,
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    ...over,
  };
}

function weekBucket(
  period_id: string,
  start_ms: number,
  end_ms: number
): ViewBucket {
  return { period_id, period_type: "weekly", start_ms, end_ms };
}

describe("derive_budget_view_periods", () => {
  it("pro-rates a full in-month week from the monthly allocation", () => {
    // 7 days × (600/30 = 20/day) = 140.
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("2026W_JUN2", JUN_08, JUN_14)],
      [junMonthly()],
      []
    );
    expect(wk.allocated_amount).toBe(140);
    expect(wk.effective_amount).toBe(140);
    expect(wk.spent).toBe(0);
    expect(wk.remaining).toBe(140);
    expect(wk.is_derived).toBe(true);
    expect(wk.period_type).toBe("weekly");
  });

  it("buckets spent by date (only in-window splits count)", () => {
    const splits = [
      split({ amount: 50, txn_date_ms: JUN_10 }), // inside Jun 8–14
      split({ amount: 30, txn_date_ms: JUN_01 }), // outside the week
    ];
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly()],
      splits
    );
    expect(wk.spent).toBe(50);
    expect(wk.remaining).toBe(90); // 140 − 50
  });

  it("folds monthly rollover into effective → remaining", () => {
    // effective 900 (600 + 300 rollover) → daily 30 → week = 210.
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly({ effective_amount: 900 })],
      [split({ amount: 60, txn_date_ms: JUN_10 })]
    );
    expect(wk.allocated_amount).toBe(140); // base limit unaffected
    expect(wk.effective_amount).toBe(210); // rollover folded in
    expect(wk.remaining).toBe(150); // 210 − 60
  });

  it("sums both months for a week straddling the month boundary", () => {
    // Jun 29–30 (2 days @ 600/30=20) + Jul 1–5 (5 days @ 620/31=20) = 40 + 100 = 140.
    const julMonthly: MonthlyPeriodForDerivation = {
      allocated_amount: 620,
      effective_amount: 620,
      start_ms: JUL_01,
      end_ms: JUL_31,
    };
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("boundary", JUN_29, JUL_05)],
      [junMonthly(), julMonthly],
      []
    );
    expect(wk.allocated_amount).toBe(140);
  });

  it("ignores non-overlapping monthly periods", () => {
    const julMonthly: MonthlyPeriodForDerivation = {
      allocated_amount: 9999,
      effective_amount: 9999,
      start_ms: JUL_01,
      end_ms: JUL_31,
    };
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly(), julMonthly],
      []
    );
    expect(wk.allocated_amount).toBe(140); // July contributes nothing
  });

  it("refund split stays in spent AND accrues return_amount", () => {
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly()],
      [split({ amount: 40, txn_date_ms: JUN_10, spend_status: "refund" })]
    );
    expect(wk.spent).toBe(40);
    expect(wk.return_amount).toBe(40);
    expect(wk.remaining).toBe(100); // 140 − 40
  });

  it("a full month of weekly buckets ≈ the month's allocation (parity)", () => {
    // Tile June into 4 clean 7-day weeks + a 2-day remainder = 30 days.
    const buckets: ViewBucket[] = [
      weekBucket("w1", Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 7, 23, 59, 59)),
      weekBucket("w2", Date.UTC(2026, 5, 8), Date.UTC(2026, 5, 14, 23, 59, 59)),
      weekBucket("w3", Date.UTC(2026, 5, 15), Date.UTC(2026, 5, 21, 23, 59, 59)),
      weekBucket("w4", Date.UTC(2026, 5, 22), Date.UTC(2026, 5, 28, 23, 59, 59)),
      weekBucket("w5", Date.UTC(2026, 5, 29), Date.UTC(2026, 5, 30, 23, 59, 59)),
    ];
    const derived = derive_budget_view_periods(BUDGET, buckets, [junMonthly()], []);
    const total = derived.reduce((s, d) => s + d.allocated_amount, 0);
    // 20/day × 30 days = 600, the full monthly allocation.
    expect(total).toBe(600);
  });

  it("omits buckets before the budget's active start (no appearing in past periods)", () => {
    const junWeek = weekBucket("jun", JUN_08, JUN_14); // ends before a Jul-01 start
    const julWeek = weekBucket("jul", JUL_01, Date.UTC(2026, 6, 7, 23, 59, 59));
    const periods = derive_budget_view_periods(
      BUDGET,
      [junWeek, julWeek],
      [junMonthly(), { allocated_amount: 600, effective_amount: 600, start_ms: JUL_01, end_ms: JUL_31 }],
      [],
      JUL_01 // active_start_ms — budget's first period starts in July
    );
    // June bucket is entirely before the active start → omitted; only July survives.
    expect(periods.map((p) => p.period_id)).toEqual(["jul"]);
  });

  it("omits buckets after a non-ongoing budget's active end", () => {
    const junWeek = weekBucket("jun", JUN_08, JUN_14);
    const julWeek = weekBucket("jul", JUL_01, Date.UTC(2026, 6, 7, 23, 59, 59));
    const periods = derive_budget_view_periods(
      BUDGET,
      [junWeek, julWeek],
      [junMonthly()],
      [],
      JUN_01,
      JUN_30 // active_end_ms — budget ended in June
    );
    expect(periods.map((p) => p.period_id)).toEqual(["jun"]);
  });

  it("emits all buckets when no active range is given (unchanged behavior)", () => {
    const junWeek = weekBucket("jun", JUN_08, JUN_14);
    const julWeek = weekBucket("jul", JUL_01, Date.UTC(2026, 6, 7, 23, 59, 59));
    const periods = derive_budget_view_periods(BUDGET, [junWeek, julWeek], [junMonthly()], []);
    expect(periods.map((p) => p.period_id)).toEqual(["jun", "jul"]);
  });
});

describe("derive_budget_view_periods — daily_spent (budget daily chart)", () => {
  const sum_cents = (days: number[]) => days.reduce((s, v) => s + Math.round(v * 100), 0);
  const JUN = (d: number, h = 12) => Date.UTC(2026, 5, d, h);

  it("places each counted split on its UTC day and sums exactly to spent", () => {
    const splits = [
      split({ amount: 50.1, txn_date_ms: JUN(8, 0) }), // first day, midnight → index 0
      split({ amount: 20, txn_date_ms: JUN(9), spend_status: "refund" }), // refund stays in spent
      split({ amount: 15, txn_date_ms: JUN(9), is_income: true }), // expense-category credit nets down
      split({ amount: 12.34, txn_date_ms: JUN(10), is_pending: true }), // pending counts like spent
      split({ amount: 999, txn_date_ms: JUN(10), spend_status: "ignored" }), // excluded
      split({ amount: 777, txn_date_ms: JUN(11), outflow_id: "bill" }), // recurring: excluded
      split({ amount: 7.77, txn_date_ms: JUN(14, 23) }), // last day → index 6
      split({ amount: 500, txn_date_ms: JUN(15) }), // outside the week
    ];
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly()],
      splits
    );
    expect(wk.spent).toBe(75.21); // 50.10 + 20 − 15 + 12.34 + 7.77
    expect(wk.daily_spent).toEqual([50.1, 5, 12.34, 0, 0, 0, 7.77]);
    expect(sum_cents(wk.daily_spent)).toBe(Math.round(wk.spent * 100));
  });

  it("puts the rounding remainder on the last non-zero day", () => {
    const splits = [
      split({ amount: 0.333, txn_date_ms: JUN(8) }),
      split({ amount: 0.333, txn_date_ms: JUN(10) }),
      split({ amount: 0.333, txn_date_ms: JUN(12) }),
    ];
    const [wk] = derive_budget_view_periods(BUDGET, [weekBucket("w", JUN_08, JUN_14)], [junMonthly()], splits);
    expect(wk.spent).toBe(1);
    expect(wk.daily_spent).toEqual([0.33, 0, 0.33, 0, 0.34, 0, 0]);
    expect(sum_cents(wk.daily_spent)).toBe(100);
  });

  it("has one entry per calendar day (monthly = 30 for June), zeros when nothing counted", () => {
    const [m] = derive_budget_view_periods(
      BUDGET,
      [{ period_id: "2026M06", period_type: "monthly", start_ms: JUN_01, end_ms: JUN_30 }],
      [junMonthly()],
      [split({ amount: 40, txn_date_ms: JUN(30, 23) })]
    );
    expect(m.daily_spent).toHaveLength(30);
    expect(m.daily_spent[29]).toBe(40);
    expect(sum_cents(m.daily_spent)).toBe(4000);
    const [empty] = derive_budget_view_periods(BUDGET, [weekBucket("w", JUN_08, JUN_14)], [junMonthly()], []);
    expect(empty.daily_spent).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("paused days carry no spend (it is Everything Else's)", () => {
    const [wk] = derive_budget_view_periods(
      BUDGET,
      [weekBucket("w", JUN_08, JUN_14)],
      [junMonthly()],
      [split({ amount: 30, txn_date_ms: JUN(9) }), split({ amount: 10, txn_date_ms: JUN(12) })],
      undefined,
      undefined,
      undefined,
      [{ start_day: Math.floor(JUN(9) / 86_400_000), end_day: Math.floor(JUN(9) / 86_400_000) }]
    );
    expect(wk.spent).toBe(10);
    expect(wk.daily_spent).toEqual([0, 0, 0, 0, 10, 0, 0]);
  });
});

describe("derive_budget_view_periods — spend breakdown (Easy to change tips)", () => {
  const JUN = (d: number, h = 12) => Date.UTC(2026, 5, d, h);
  const week = (splits: SplitForSpend[], paused?: Array<{ start_day: number; end_day: number }>) =>
    derive_budget_view_periods(
      BUDGET, [weekBucket("w", JUN_08, JUN_14)], [junMonthly()], splits,
      undefined, undefined, undefined, paused
    )[0];

  it("dailyCount counts purchases only, on the same days as dailySpent", () => {
    const splits = [
      split({ amount: 5, txn_date_ms: JUN(8), vendor_key: "a" }),
      split({ amount: 6, txn_date_ms: JUN(8), vendor_key: "a" }),
      split({ amount: 20, txn_date_ms: JUN(9), spend_status: "refund" }), // still a purchase
      split({ amount: 15, txn_date_ms: JUN(9), is_income: true }), // credit: not a purchase
      split({ amount: 999, txn_date_ms: JUN(10), spend_status: "ignored" }), // excluded
      split({ amount: 999, txn_date_ms: JUN(10), is_transfer: true }), // excluded
      split({ amount: 999, txn_date_ms: JUN(11), outflow_id: "bill" }), // bill-linked: excluded
      split({ amount: 999, txn_date_ms: JUN(11), is_income_category: true }), // income: excluded
      split({ amount: 7, txn_date_ms: JUN(14, 23) }),
      split({ amount: 50, txn_date_ms: JUN(13) }), // paused day: excluded
    ];
    const wk = week(splits, [{ start_day: Math.floor(JUN(13) / 86_400_000), end_day: Math.floor(JUN(13) / 86_400_000) }]);
    expect(wk.daily_count).toEqual([2, 1, 0, 0, 0, 0, 1]);
    expect(wk.daily_count).toHaveLength(wk.daily_spent.length);
    expect(wk.daily_count.reduce((a, b) => a + b, 0)).toBe(4);
    // Every day with a purchase has spend booked on that same day.
    wk.daily_count.forEach((n, i) => { if (n > 0) expect(wk.daily_spent[i]).not.toBe(0); });
    expect(wk.spent).toBe(5 + 6 + 20 - 15 + 7);
  });

  it("groups places by vendor key: net total, count, smallCount, top 8 by total", () => {
    const splits: SplitForSpend[] = [];
    // 10 places, place p<i> spends 10*(i+1) in one purchase.
    for (let i = 0; i < 10; i++) {
      splits.push(split({ amount: 10 * (i + 1), vendor_key: `p${i}`, place_name: `Place ${i}` }));
    }
    // Coffee: 3 small buys + 1 big, and a refund credit netting it down.
    splits.push(split({ amount: 4.5, vendor_key: "coffee", place_name: "Coffee" }));
    splits.push(split({ amount: 4.25, vendor_key: "coffee", place_name: "Coffee" }));
    splits.push(split({ amount: 24.99, vendor_key: "coffee", place_name: "Coffee" }));
    splits.push(split({ amount: 30, vendor_key: "coffee", place_name: "Coffee" }));
    splits.push(split({ amount: 4.5, vendor_key: "coffee", place_name: "Coffee", is_income: true }));
    // A place netted to zero is dropped; an ignored purchase never counts.
    splits.push(split({ amount: 12, vendor_key: "zero" }));
    splits.push(split({ amount: 12, vendor_key: "zero", is_income: true }));
    splits.push(split({ amount: 500, vendor_key: "ignored", spend_status: "ignored" }));
    const wk = week(splits);
    expect(wk.places).toHaveLength(8);
    expect(wk.places[0]).toEqual({ key: "p9", name: "Place 9", count: 1, small_count: 0, total: 100, code: "" });
    const coffee = wk.places.find((p) => p.key === "coffee");
    expect(coffee).toEqual({ key: "coffee", name: "Coffee", count: 4, small_count: 3, total: 59.24, code: "" });
    expect(wk.places.map((p) => p.total)).toEqual([...wk.places.map((p) => p.total)].sort((a, b) => b - a));
    expect(wk.places.some((p) => p.key === "zero" || p.key === "ignored")).toBe(false);
    expect(wk.places.some((p) => p.key === "p0" || p.key === "p1")).toBe(false); // 10, 20 < cut
  });

  it("splits without a vendor key are counted in spent but not in places", () => {
    const wk = week([split({ amount: 10 }), split({ amount: 5, vendor_key: "a", place_name: "A" })]);
    expect(wk.spent).toBe(15);
    expect(wk.places).toEqual([{ key: "a", name: "A", count: 1, small_count: 1, total: 5, code: "" }]);
  });

  it("breaks out bank fees by kind (still in spent), only kinds present", () => {
    const wk = week([
      split({ amount: 3, fee_kind: "atm" }),
      split({ amount: 2.5, fee_kind: "atm" }),
      split({ amount: 35, fee_kind: "overdraft" }),
      split({ amount: 35, fee_kind: "overdraft", is_income: true }), // reversed fee nets down
      split({ amount: 40 }),
      split({ amount: 9, fee_kind: "late", spend_status: "ignored" }), // ignored: not a fee here
    ]);
    expect(wk.spent).toBe(45.5);
    // A fully reversed overdraft fee nets to $0 → not a tip, dropped.
    expect(wk.fees).toEqual([{ kind: "atm", count: 2, total: 5.5 }]);
  });
});

describe("places — top 8 by total ∪ top 8 by purchase count, with each place's category code", () => {
  const week = (splits: SplitForSpend[]) =>
    derive_budget_view_periods(BUDGET, [weekBucket("w", JUN_08, JUN_14)], [junMonthly()], splits)[0];

  it("keeps a frequent small habit that the total cut would drop (Java Jo's case), deduped", () => {
    const splits: SplitForSpend[] = [];
    // 10 big one-off places ($200 … $110): they fill the top 8 by total.
    for (let i = 0; i < 10; i++) {
      splits.push(split({ amount: 200 - 10 * i, vendor_key: `big${i}`, place_name: `Big ${i}` }));
    }
    // A coffee habit: 7 purchases, $82 — 11th by total, 1st by count.
    for (let i = 0; i < 7; i++) {
      splits.push(split({ amount: i === 0 ? 16 : 11, vendor_key: "java", place_name: "Java Jo's",
        category_code: "FOOD_AND_DRINK_COFFEE" }));
    }
    // 2 purchases each: counted 2nd–4th by count.
    for (const k of ["s1", "s2", "s3"]) {
      splits.push(split({ amount: 35, vendor_key: k }), split({ amount: 35, vendor_key: k }));
    }
    const wk = week(splits);
    const keys = wk.places.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    // Top 8 by total = big0…big7 (s1–s3 at $70 sit below big7's $130).
    // Top 8 by count = java, s1, s2, s3, then the 1-purchase places by total: big0…big3.
    expect(keys).toEqual(["big0", "big1", "big2", "big3", "big4", "big5", "big6", "big7", "java", "s1", "s2", "s3"]);
    expect(wk.places.find((p) => p.key === "java")).toEqual({
      key: "java", name: "Java Jo's", count: 7, small_count: 7, total: 82, code: "FOOD_AND_DRINK_COFFEE",
    });
    expect(keys).not.toContain("big8");
    expect(wk.places.map((p) => p.total)).toEqual([...wk.places.map((p) => p.total)].sort((a, b) => b - a));
  });

  it("returns at most 16 places when the two top-8 lists don't overlap", () => {
    const splits: SplitForSpend[] = [];
    for (let i = 0; i < 12; i++) splits.push(split({ amount: 500 + i, vendor_key: `big${i}` }));
    for (let i = 0; i < 12; i++) {
      for (let n = 0; n < 3; n++) splits.push(split({ amount: 5 + i / 100, vendor_key: `small${i}` }));
    }
    expect(week(splits).places).toHaveLength(16);
  });

  it("code = the most common code among the place's purchases (credits don't vote; ties alphabetical)", () => {
    const wk = week([
      split({ amount: 8, vendor_key: "a", category_code: "FOOD_AND_DRINK_FAST_FOOD" }),
      split({ amount: 8, vendor_key: "a", category_code: "FOOD_AND_DRINK_COFFEE" }),
      split({ amount: 8, vendor_key: "a", category_code: "FOOD_AND_DRINK_COFFEE" }),
      split({ amount: 8, vendor_key: "a", category_code: "FOOD_AND_DRINK_FAST_FOOD", is_income: true }),
      split({ amount: 8, vendor_key: "a", category_code: "FOOD_AND_DRINK_FAST_FOOD", is_income: true }),
      split({ amount: 5, vendor_key: "t", category_code: "FOOD_AND_DRINK_RESTAURANT" }),
      split({ amount: 5, vendor_key: "t", category_code: "FOOD_AND_DRINK_COFFEE" }),
      split({ amount: 5, vendor_key: "u" }),
    ]);
    const code = (k: string) => wk.places.find((p) => p.key === k)?.code;
    expect(code("a")).toBe("FOOD_AND_DRINK_COFFEE");
    expect(code("t")).toBe("FOOD_AND_DRINK_COFFEE");
    expect(code("u")).toBe("");
  });
});
