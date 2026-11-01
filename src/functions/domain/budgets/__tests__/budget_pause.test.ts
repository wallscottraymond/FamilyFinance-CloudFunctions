/**
 * Budget pause (Code-Health-Review M1-M1, PZ1–PZ6) — the read-time rules.
 *
 * Proof map (each defect class → its tests):
 *   1. day-range bookkeeping (pause / resume / partial resume / merge)  → "pause ranges"
 *   2. a paused day's spending belongs to Everything Else, in EVERY read path (they all go
 *      through resolve_split_owner / owned_splits_for_budget)                → "ownership"
 *   3. the paused days' share leaves the budget's amount, in any view cadence → "allocation"
 *   4. an unpaused budget is byte-for-byte unchanged                        → "unchanged"
 */

import {
  apply_pause_change,
  day_from_iso,
  iso_from_day,
  is_paused_on,
  normalize_paused_ranges,
  paused_days_in,
  unpaused_segments,
  PausedDayRange,
} from "../budget_pause.service";
import {
  resolve_split_owner,
  owned_splits_for_budget,
  SplitForOnReadMatch,
} from "../budget_spend_match.service";
import { compute_budget_spent } from "../budget_spend.service";
import { derive_budget_view_periods, MonthlyPeriodForDerivation } from "../budget_view.service";
import { BudgetForMatch } from "../../transactions/match_budget.service";

const d = (iso: string): number => day_from_iso(iso)!;
const ms = (iso: string, h = 12): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), h);
const end_of = (iso: string): number => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 23, 59, 59, 999);
const range = (a: string, b: string): PausedDayRange => ({ start_day: d(a), end_day: d(b) });

describe("pause ranges", () => {
  it("parses and prints UTC days; rejects impossible dates", () => {
    expect(iso_from_day(d("2026-11-02"))).toBe("2026-11-02");
    expect(day_from_iso("2026-02-30")).toBeNull();
    expect(day_from_iso("2026-11-2")).toBeNull();
  });

  it("pause merges overlapping and adjacent ranges", () => {
    const r = apply_pause_change([range("2026-11-02", "2026-11-08")], d("2026-11-09"), d("2026-11-15"), true);
    expect(r).toEqual([range("2026-11-02", "2026-11-15")]);
    expect(normalize_paused_ranges([range("2026-11-10", "2026-11-12"), range("2026-11-01", "2026-11-11")]))
      .toEqual([range("2026-11-01", "2026-11-12")]);
  });

  it("resume removes exactly those days (a resumed week inside a paused month splits it)", () => {
    const month = [range("2026-11-01", "2026-11-30")];
    expect(apply_pause_change(month, d("2026-11-08"), d("2026-11-14"), false)).toEqual([
      range("2026-11-01", "2026-11-07"),
      range("2026-11-15", "2026-11-30"),
    ]);
    expect(apply_pause_change(month, d("2026-11-01"), d("2026-11-30"), false)).toEqual([]);
    expect(apply_pause_change([], d("2026-11-01"), d("2026-11-30"), false)).toEqual([]);
  });

  it("is_paused_on / paused_days_in use whole UTC days", () => {
    const r = [range("2026-11-02", "2026-11-08")];
    expect(is_paused_on(r, Date.UTC(2026, 10, 2, 0, 0))).toBe(true);
    expect(is_paused_on(r, Date.UTC(2026, 10, 8, 23, 59, 59, 999))).toBe(true);
    expect(is_paused_on(r, Date.UTC(2026, 10, 9, 0, 0))).toBe(false);
    expect(is_paused_on(r, Date.UTC(2026, 10, 1, 23, 59, 59, 999))).toBe(false);
    expect(paused_days_in(r, ms("2026-11-01", 0), end_of("2026-11-30"))).toBe(7);
    expect(paused_days_in(r, ms("2026-11-05", 0), end_of("2026-11-20"))).toBe(4);
    expect(paused_days_in(undefined, 0, 1)).toBe(0);
  });

  it("unpaused_segments: whole range when nothing is paused; gaps around a pause", () => {
    const s = ms("2026-11-01", 0);
    const e = end_of("2026-11-30");
    expect(unpaused_segments([], s, e)).toEqual([{ start_ms: s, end_ms: e }]);
    expect(unpaused_segments([range("2026-11-02", "2026-11-08")], s, e)).toEqual([
      { start_ms: s, end_ms: end_of("2026-11-01") },
      { start_ms: ms("2026-11-09", 0), end_ms: e },
    ]);
    expect(unpaused_segments([range("2026-10-01", "2026-12-31")], s, e)).toEqual([]);
  });
});

// ── ownership ──────────────────────────────────────────────────────────────────────────────
const G = "b_groceries";
const EE = "b_ee";
function budget(over: Partial<BudgetForMatch> = {}): BudgetForMatch {
  return {
    id: G,
    category_ids: ["groceries"],
    start_ms: Date.UTC(2020, 0, 1),
    end_ms: null,
    is_ongoing: true,
    cadence: "monthly",
    ...over,
  };
}
function split(over: Partial<SplitForOnReadMatch> = {}): SplitForOnReadMatch {
  return {
    amount: 50,
    txn_date_ms: ms("2026-11-04"),
    is_pending: false,
    is_transfer: false,
    is_income: false,
    spend_status: "counted",
    outflow_id: null,
    inflow_id: null,
    first_category_id: "groceries",
    semantic_code: "FOOD_AND_DRINK_GROCERIES",
    manual_pin_budget_id: null,
    ...over,
  };
}
const PAUSED = budget({ paused_ranges: [range("2026-11-02", "2026-11-08")] });

describe("ownership: a paused day's spending belongs to Everything Else (PZ1)", () => {
  it("category match on a paused day → Everything Else; the next day → the budget", () => {
    expect(resolve_split_owner(split(), [PAUSED], EE)).toBe(EE);
    expect(resolve_split_owner(split({ txn_date_ms: ms("2026-11-09") }), [PAUSED], EE)).toBe(G);
    expect(resolve_split_owner(split({ txn_date_ms: ms("2026-11-01") }), [PAUSED], EE)).toBe(G);
  });

  it("a manual pin to the paused budget also moves (and still counts as spending in EE)", () => {
    // A pinned TRANSFER: the pin made it spending; it must stay spending once it moves to EE.
    const pinned = split({ manual_pin_budget_id: G, is_transfer: true, semantic_code: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
    expect(resolve_split_owner(pinned, [PAUSED], EE)).toBe(EE);
    const in_ee = owned_splits_for_budget(EE, [PAUSED], EE, [pinned]);
    expect(in_ee).toHaveLength(1);
    expect(compute_budget_spent(EE, ms("2026-11-01", 0), end_of("2026-11-30"), in_ee).spent).toBe(50);
    expect(owned_splits_for_budget(G, [PAUSED], EE, [pinned])).toHaveLength(0);
  });

  it("the budget's spend leaves out the paused days; EE's takes them", () => {
    const splits = [split(), split({ txn_date_ms: ms("2026-11-20"), amount: 30 })];
    const nov = [ms("2026-11-01", 0), end_of("2026-11-30")] as const;
    expect(compute_budget_spent(G, ...nov, owned_splits_for_budget(G, [PAUSED], EE, splits)).spent).toBe(30);
    expect(compute_budget_spent(EE, ...nov, owned_splits_for_budget(EE, [PAUSED], EE, splits)).spent).toBe(50);
  });

  it("a pin to ANOTHER budget is untouched by this budget's pause", () => {
    const other = budget({ id: "b_dining", category_ids: ["dining"] });
    const s = split({ manual_pin_budget_id: "b_dining" });
    expect(resolve_split_owner(s, [PAUSED, other], EE)).toBe("b_dining");
  });
});

// ── allocation ─────────────────────────────────────────────────────────────────────────────
// November 2026: 30 days, $600 → $20/day.
const NOV: MonthlyPeriodForDerivation = {
  allocated_amount: 600,
  effective_amount: 660, // + $60 rollover
  start_ms: ms("2026-11-01", 0),
  end_ms: end_of("2026-11-30"),
};
const bucket = (id: string, a: string, b: string, type: "weekly" | "monthly" = "weekly") =>
  ({ period_id: id, period_type: type, start_ms: ms(a, 0), end_ms: end_of(b) });
const P = [range("2026-11-01", "2026-11-07")];

describe("allocation: the paused days' share leaves the budget (PZ1, PZ5)", () => {
  it("weekly view: the paused week is Paused · $0; the next week is untouched", () => {
    const [w1, w2] = derive_budget_view_periods(
      G,
      [bucket("2026W45", "2026-11-01", "2026-11-07"), bucket("2026W46", "2026-11-08", "2026-11-14")],
      [NOV], [], undefined, undefined, undefined, P
    );
    expect(w1).toMatchObject({ allocated_amount: 0, effective_amount: 0, remaining: 0, paused_days: 7, is_paused: true });
    expect(w2).toMatchObject({ allocated_amount: 140, effective_amount: 154, paused_days: 0, is_paused: false });
  });

  it("monthly view: those 7 days' share is taken out → Partly paused", () => {
    const [m] = derive_budget_view_periods(G, [bucket("2026M11", "2026-11-01", "2026-11-30", "monthly")], [NOV], [], undefined, undefined, undefined, P);
    expect(m).toMatchObject({ allocated_amount: 460, effective_amount: 506, paused_days: 7, is_paused: false });
  });

  it("a This-Period-Only adjustment on paused days leaves with them", () => {
    const adj = { ...NOV, adjustments: [{ period_id: "2026W45", start_ms: ms("2026-11-01", 0), end_ms: end_of("2026-11-07"), amount: 70 }] };
    const [m] = derive_budget_view_periods(G, [bucket("2026M11", "2026-11-01", "2026-11-30", "monthly")], [adj], [], undefined, undefined, undefined, P);
    expect(m.allocated_amount).toBe(460);
  });
});

describe("unchanged: no pause → exactly the old result", () => {
  it("empty or absent ranges give the same periods, flagged not paused", () => {
    const b = [bucket("2026M11", "2026-11-01", "2026-11-30", "monthly")];
    const before = derive_budget_view_periods(G, b, [NOV], []);
    const with_empty = derive_budget_view_periods(G, b, [NOV], [], undefined, undefined, undefined, []);
    expect(with_empty).toEqual(before);
    expect(before[0]).toMatchObject({ allocated_amount: 600, effective_amount: 660, paused_days: 0, is_paused: false });
  });
});

// ── the callable's rule ────────────────────────────────────────────────────────────────────
import {
  compute_budget_pause,
  pause_recompute_dates,
  without_paused_days,
  MAX_PAUSE_DAYS,
} from "../budget_pause.service";

describe("compute_budget_pause (set_budget_pause's domain rule)", () => {
  const base = { current: [] as PausedDayRange[], paused: true, is_everything_else: false };
  it("pauses and resumes exactly the given days", () => {
    const on = compute_budget_pause({ ...base, start_day: "2026-11-01", end_day: "2026-11-07" });
    expect(on.entity).toEqual([range("2026-11-01", "2026-11-07")]);
    const off = compute_budget_pause({ ...base, current: on.entity!, paused: false, start_day: "2026-11-01", end_day: "2026-11-07" });
    expect(off.entity).toEqual([]);
  });
  it("is idempotent: pausing twice = once", () => {
    const once = compute_budget_pause({ ...base, start_day: "2026-11-01", end_day: "2026-11-07" }).entity!;
    expect(compute_budget_pause({ ...base, current: once, start_day: "2026-11-01", end_day: "2026-11-07" }).entity).toEqual(once);
  });
  it("refuses Everything Else, bad dates, reversed ranges, and more than one period", () => {
    expect(compute_budget_pause({ ...base, is_everything_else: true, start_day: "2026-11-01", end_day: "2026-11-07" }).validation_errors).toBeDefined();
    expect(compute_budget_pause({ ...base, start_day: "2026-02-30", end_day: "2026-03-01" }).validation_errors).toBeDefined();
    expect(compute_budget_pause({ ...base, start_day: "2026-11-07", end_day: "2026-11-01" }).validation_errors).toBeDefined();
    const too_long = iso_from_day(d("2026-01-01") + MAX_PAUSE_DAYS);
    expect(compute_budget_pause({ ...base, start_day: "2026-01-01", end_day: too_long }).validation_errors).toBeDefined();
  });
  it("recompute dates: one per day (any stored period holding a paused day recomputes)", () => {
    const dates = pause_recompute_dates("2026-11-30", "2026-12-02");
    expect(dates.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
  });
  it("stored spent leaves paused days out (without_paused_days)", () => {
    const items = [{ txn_date_ms: ms("2026-11-03"), a: 1 }, { txn_date_ms: ms("2026-11-10"), a: 2 }];
    expect(without_paused_days(items, P)).toEqual([items[1]]);
    expect(without_paused_days(items, [])).toBe(items);
  });
});

// ── rollover (PZ6): the next period carries exactly what the paused period's page showed ───
import { calculateRolloverForPeriod, rolloverPauseOf } from "../../../budgets/utils/rolloverCalculation";
import { Timestamp } from "firebase-admin/firestore";
import { BudgetPeriodDocument, Budget } from "../../../../types";

describe("rollover carries only the unpaused share (PZ6)", () => {
  const period = (id: string, a: string, b: string, over: Record<string, unknown> = {}) =>
    ({
      id, budgetId: G, periodType: "monthly",
      periodStart: Timestamp.fromMillis(ms(a, 0)), periodEnd: Timestamp.fromMillis(end_of(b)),
      allocatedAmount: 600, spent: 0, rolledOverAmount: 0, ...over,
    }) as unknown as BudgetPeriodDocument;
  const nov = (over: Record<string, unknown> = {}) => period("G_2026M11", "2026-11-01", "2026-11-30", over);
  const dec = period("G_2026M12", "2026-12-01", "2026-12-31");
  const settings = { enabled: true, strategy: "immediate" as const, spreadPeriods: 3 };
  const AFTER = Date.UTC(2027, 0, 1);
  const budget_doc = (ranges: Array<{ start: string; end: string }>) =>
    ({ id: G, name: "Groceries", period: "monthly", startDate: Timestamp.fromMillis(Date.UTC(2026, 0, 1)), isOngoing: true, pausedRanges: ranges }) as unknown as Budget;

  it("no pause → unchanged (600 − 100 = 500)", () => {
    expect(rolloverPauseOf(budget_doc([]))).toBeUndefined();
    expect(calculateRolloverForPeriod(dec, nov({ spent: 100 }), settings, AFTER).rolledOverAmount).toBe(500);
  });
  it("first week of Nov paused, $100 unpaused spend → carries 460 − 100 = 360", () => {
    const pause = rolloverPauseOf(budget_doc([{ start: "2026-11-01", end: "2026-11-07" }]));
    expect(calculateRolloverForPeriod(dec, nov({ spent: 100 }), settings, AFTER, pause).rolledOverAmount).toBe(360);
  });
  it("all of November paused → carries nothing (its rollover-in included)", () => {
    const pause = rolloverPauseOf(budget_doc([{ start: "2026-11-01", end: "2026-11-30" }]));
    expect(calculateRolloverForPeriod(dec, nov({ rolledOverAmount: 50 }), settings, AFTER, pause).rolledOverAmount).toBe(0);
  });
  it("a pause in another month doesn't touch November's carry", () => {
    const pause = rolloverPauseOf(budget_doc([{ start: "2026-10-01", end: "2026-10-07" }]));
    expect(calculateRolloverForPeriod(dec, nov({ spent: 100 }), settings, AFTER, pause).rolledOverAmount).toBe(500);
  });
});
