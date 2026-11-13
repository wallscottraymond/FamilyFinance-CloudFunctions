/**
 * Income parts (Income-Detail-Screen): which parts apply, history, plan amounts, overrides,
 * received splits, and the hook into build_expected_occurrences / placement.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  IncomePart,
  parse_income_parts,
  parse_occurrence_parts,
  parse_forecast_settings,
  compute_part_stats,
  make_expected_parts_calculator,
  make_is_last_of_month,
  received_check_parts,
  sum_parts,
} from "../income_parts.service";
import { build_expected_occurrences, RecurringForExpected } from "../expected_occurrences.service";
import { attach_income_parts } from "../../periods/period_view.service";
import { place_occurrences } from "../occurrence_placement.service";
import type { ReconciledOccurrence } from "../reconcile_occurrences.service";

const D = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const BASE: IncomePart = { id: "base", kind: "base", schedule: "every", plan: "set", amount: 3092 };
const COMMISSION: IncomePart = {
  id: "comm", kind: "commission", schedule: "end_of_month", plan: "typical", takes_rest: true,
};

/** Egnyte: a 3092 check on the 13th, and 3092 + commission on the 28th (last of the month). */
function egnyte_deposits(commissions: number[]) {
  // months Jun..Oct 2026 for the commissions given (oldest first)
  const out: Array<{ date_ms: number; amount: number }> = [];
  commissions.forEach((c, i) => {
    const m = 10 - (commissions.length - 1 - i); // ends at October
    out.push({ date_ms: D(2026, m, 13), amount: 3092 });
    out.push({ date_ms: D(2026, m, 28), amount: 3092 + c });
  });
  return out;
}

function calc(parts: IncomePart[], deposits: Array<{ date_ms: number; amount: number }>, extra: object = {}) {
  const all = [...deposits.map((d) => d.date_ms), D(2026, 11, 13), D(2026, 11, 28), D(2026, 12, 13), D(2026, 12, 28)];
  return make_expected_parts_calculator({ parts, deposits, ...extra }, make_is_last_of_month(all));
}

describe("parsing", () => {
  it("drops malformed parts, caps at 8, keeps at most one takesRest", () => {
    const raw = [
      { id: "a", kind: "base", schedule: "every", plan: "set", amount: 10, takesRest: true },
      { id: "b", kind: "commission", schedule: "every", plan: "avg", takesRest: true },
      { id: "c", kind: "nonsense", schedule: "every", plan: "set" },
      { id: "d", kind: "base", schedule: "months", plan: "set" }, // months missing
      "junk",
      { id: "a", kind: "base", schedule: "every", plan: "set" }, // duplicate id
      ...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, kind: "custom", schedule: "every", plan: "none" })),
    ];
    const parts = parse_income_parts(raw);
    expect(parts.length).toBe(8);
    expect(parts.filter((p) => p.takes_rest).length).toBe(1);
    expect(parts[0].takes_rest).toBe(true);
    expect(parts.find((p) => p.id === "c")).toBeUndefined();
    expect(parse_income_parts("nope")).toEqual([]);
  });

  it("defaults forecast settings and ignores bad occurrenceParts", () => {
    expect(parse_forecast_settings(undefined)).toEqual({ careful_months: 6, careful_rule: "lowest" });
    expect(parse_forecast_settings({ carefulMonths: 5, carefulRule: "x" })).toEqual({ careful_months: 6, careful_rule: "lowest" });
    expect(parse_forecast_settings({ carefulMonths: 12, carefulRule: "low_end" })).toEqual({ careful_months: 12, careful_rule: "low_end" });
    const m = parse_occurrence_parts({
      "2026-10-28": [{ partId: "comm", kind: "commission", amount: 5 }, { kind: "bogus", amount: 1 }, { kind: "tips", amount: -1 }],
      "bad-key": [{ kind: "tips", amount: 1 }],
    });
    expect(Object.keys(m)).toEqual(["2026-10-28"]);
    expect(m["2026-10-28"].length).toBe(1);
  });
});

describe("Egnyte: base every check + commission takesRest on end_of_month", () => {
  const deposits = egnyte_deposits([4000, 6000, 8000, 10000, 12000]); // Jun..Oct
  const parts = [BASE, COMMISSION];

  it("mid-month check is base only; last check is base + typical (median) commission", () => {
    const f = calc(parts, deposits);
    const mid = f(D(2026, 11, 13));
    expect(mid.map((p) => p.part_id)).toEqual(["base"]);
    expect(sum_parts(mid)).toBe(3092);
    const last = f(D(2026, 11, 28));
    expect(last.map((p) => p.part_id)).toEqual(["base", "comm"]);
    expect(last[1].amount).toBe(8000); // median of 4k,6k,8k,10k,12k
    expect(last[1].sure).toBe(false);
    expect(last[0].sure).toBe(true);
    expect(sum_parts(last)).toBe(3092 + 8000);
  });

  it("stats: avg = mean of last 3, typical = median, careful = lowest over 6 months", () => {
    const [, c] = compute_part_stats({ parts, deposits });
    expect(c).toEqual({ part_id: "comm", avg: 10000, typical: 8000, careful: 4000 });
  });

  it("a mid-month deposit before the month-end check never counts as commission history", () => {
    // Nov 13 base check is in; the Nov 28 check isn't yet. Schedule says the 13th and the 28th.
    const withMid = [...deposits, { date_ms: D(2026, 11, 13), amount: 3092 }];
    const check_dates = (from: number, to: number) => {
      const out: number[] = [];
      for (let y = 2025; y <= 2027; y++) for (let m = 1; m <= 12; m++) out.push(D(y, m, 13), D(y, m, 28));
      return out.filter((ms) => ms >= from && ms <= to);
    };
    const [, c] = compute_part_stats({ parts, deposits: withMid, check_dates });
    expect(c).toEqual({ part_id: "comm", avg: 10000, typical: 8000, careful: 4000 });
    // Without the schedule, the 13th would look like the month's last check (commission ~0).
    const [, bad] = compute_part_stats({ parts, deposits: withMid });
    expect(bad.careful).toBe(0);
  });

  it("a past month with no month-end deposit adds no $0 commission point", () => {
    // Sep's month-end check never arrived: only the 13th is in for September.
    const gap = deposits.filter((d) => !(new Date(d.date_ms).getUTCMonth() === 8 && new Date(d.date_ms).getUTCDate() === 28));
    const check_dates = (from: number, to: number) => {
      const out: number[] = [];
      for (let y = 2025; y <= 2027; y++) for (let m = 1; m <= 12; m++) out.push(D(y, m, 13), D(y, m, 28));
      return out.filter((ms) => ms >= from && ms <= to);
    };
    const [, c] = compute_part_stats({ parts, deposits: gap, check_dates });
    expect(c.careful).toBe(4000); // Jun, Jul, Aug, Oct commissions only; no 0
  });

  it("a month-end check paid a couple of days early still counts as the last check", () => {
    const early = egnyte_deposits([4000, 6000]).map((d) => (new Date(d.date_ms).getUTCDate() === 28 ? { ...d, date_ms: d.date_ms - 2 * 86_400_000 } : d));
    const check_dates = (from: number, to: number) => {
      const out: number[] = [];
      for (let m = 1; m <= 12; m++) out.push(D(2026, m, 13), D(2026, m, 28));
      return out.filter((ms) => ms >= from && ms <= to);
    };
    const [, c] = compute_part_stats({ parts, deposits: early, check_dates });
    expect(c.typical).toBe(5000);
  });

  it("no history -> commission 0 (not an error)", () => {
    const f = calc(parts, []);
    const last = f(D(2026, 11, 28));
    expect(last.find((p) => p.part_id === "comm")?.amount).toBe(0);
    expect(sum_parts(f(D(2026, 11, 13)))).toBe(3092);
  });
});

describe("careful: lowest vs low_end over 3/6/12 months", () => {
  const commissions = [100, 900, 800, 700, 600, 500, 400, 300, 200, 1000, 1100, 1200]; // Nov'25..Oct'26
  const mk = () => {
    const out: Array<{ date_ms: number; amount: number }> = [];
    commissions.forEach((c, i) => {
      const idx = i; // 0 = Nov 2025
      const y = 2025 + Math.floor((10 + idx) / 12);
      const m = ((10 + idx) % 12) + 1;
      out.push({ date_ms: D(y, m, 28), amount: 3092 + c });
      out.push({ date_ms: D(y, m, 13), amount: 3092 });
    });
    return out;
  };
  const care = (months: 3 | 6 | 12, rule: "lowest" | "low_end") =>
    compute_part_stats({
      parts: [BASE, { ...COMMISSION, plan: "careful" }],
      settings: { careful_months: months, careful_rule: rule },
      deposits: mk(),
    })[1].careful;

  it("lowest over the window", () => {
    expect(care(3, "lowest")).toBe(1000); // Aug..Oct = 1000,1100,1200? window starts Jul 28 -> Aug,Sep,Oct
    expect(care(6, "lowest")).toBe(200); // May..Oct includes 200 (Jul)
    expect(care(12, "lowest")).toBe(100);
  });
  it("low_end = 25th percentile (nearest rank)", () => {
    expect(care(3, "low_end")).toBe(1000);
    expect(care(6, "low_end")).toBe(300); // [200,300,400,1000,1100,1200] -> rank ceil(1.5)=2 -> 300
    expect(care(12, "low_end")).toBe(300); // 12 values sorted -> rank ceil(3) = 3rd lowest
  });
});

describe("set / none / avg plans", () => {
  const deposits = egnyte_deposits([1000, 2000, 3000]);
  it("set uses the amount, none is 0, avg is mean of last 3", () => {
    const parts: IncomePart[] = [
      BASE,
      { id: "tip", kind: "tips", schedule: "every", plan: "none" },
      { id: "c", kind: "commission", schedule: "end_of_month", plan: "avg", takes_rest: true },
    ];
    const f = calc(parts, deposits);
    const last = f(D(2026, 11, 28));
    expect(last.find((p) => p.part_id === "tip")?.amount).toBe(0);
    expect(last.find((p) => p.part_id === "c")?.amount).toBe(2000);
  });
  it("months schedule applies only in listed months", () => {
    const parts: IncomePart[] = [BASE, { id: "q", kind: "bonus", schedule: "months", months: [12], plan: "set", amount: 500 }];
    const f = calc(parts, []);
    expect(sum_parts(f(D(2026, 11, 13)))).toBe(3092);
    expect(sum_parts(f(D(2026, 12, 13)))).toBe(3592);
  });
});

describe("one-off extra and per-check override", () => {
  const deposits = egnyte_deposits([4000, 6000, 8000]);
  it("one-off extra lands on one check only; override replaces the planned amount and is sure", () => {
    const occurrence_parts = {
      [key(D(2026, 11, 13))]: [{ kind: "reimbursement", amount: 640 }],
      [key(D(2026, 11, 28))]: [{ part_id: "comm", kind: "commission", amount: 9999 }],
    };
    const f = calc([BASE, COMMISSION], deposits, { occurrence_parts });
    const mid = f(D(2026, 11, 13));
    expect(mid.map((p) => p.kind)).toEqual(["base", "reimbursement"]);
    expect(mid[1]).toEqual({ kind: "reimbursement", amount: 640, sure: true });
    expect(sum_parts(mid)).toBe(3732);
    const last = f(D(2026, 11, 28));
    expect(last.find((p) => p.part_id === "comm")).toMatchObject({ amount: 9999, sure: true });
    expect(sum_parts(f(D(2026, 12, 13)))).toBe(3092); // other checks unaffected
  });
});

describe("planned check: edit whose part was removed", () => {
  it("stays on the check as a labelled one-off, so the total doesn't silently change", () => {
    const due = D(2026, 11, 28);
    const calc = make_expected_parts_calculator(
      { parts: [BASE], deposits: [], occurrence_parts: { [key(due)]: [{ part_id: "comm", kind: "commission", amount: 500 }] } },
      () => true
    );
    expect(calc(due).map((p) => [p.part_id ?? p.kind, p.amount, p.sure])).toEqual([["base", 3092, true], ["commission", 500, true]]);
  });
});

describe("received check split", () => {
  const is_last = (v: boolean) => v;
  it("default split: base takes min(set, deposit), commission gets the rest", () => {
    const parts = received_check_parts({ parts: [BASE, COMMISSION], amount: 13392, date_ms: D(2026, 10, 28), is_last_of_month: is_last(true) });
    expect(parts.map((p) => [p.part_id, p.amount, p.sure])).toEqual([["base", 3092, true], ["comm", 10300, true]]);
  });
  it("deposit below base: base takes all, commission 0", () => {
    const parts = received_check_parts({ parts: [BASE, COMMISSION], amount: 2000, date_ms: D(2026, 10, 28), is_last_of_month: true });
    expect(parts.map((p) => [p.part_id, p.amount])).toEqual([["base", 2000], ["comm", 0]]);
  });
  it("labelled split wins; the takesRest part absorbs the gap, floored at 0", () => {
    const occurrence_parts = {
      [key(D(2026, 10, 28))]: [
        { part_id: "base", kind: "base", amount: 3000 },
        { kind: "reimbursement", amount: 640 },
        { part_id: "comm", kind: "commission", amount: 1 }, // ignored: rest is recomputed
      ],
    };
    const parts = received_check_parts({
      parts: [BASE, COMMISSION], occurrence_parts, amount: 8000, date_ms: D(2026, 10, 28), is_last_of_month: true,
    });
    expect(parts.find((p) => p.part_id === "base")?.amount).toBe(3000);
    expect(parts.find((p) => p.kind === "reimbursement")?.amount).toBe(640);
    expect(parts.find((p) => p.part_id === "comm")?.amount).toBe(4360);
    expect(sum_parts(parts)).toBe(8000);
    const tiny = received_check_parts({
      parts: [BASE, COMMISSION], occurrence_parts, amount: 3500, date_ms: D(2026, 10, 28), is_last_of_month: true,
    });
    expect(tiny.find((p) => p.part_id === "comm")?.amount).toBe(0);
  });
  it("a mid-month deposit bigger than base: parts still add up (extra goes to the rest part)", () => {
    const parts = received_check_parts({ parts: [BASE, COMMISSION], amount: 3500, date_ms: D(2026, 10, 13), is_last_of_month: false });
    expect(parts.map((p) => [p.part_id, p.amount])).toEqual([["base", 3092], ["comm", 408]]);
  });
  it("no part takes the rest: the leftover shows as Other", () => {
    const parts = received_check_parts({ parts: [BASE], amount: 3200, date_ms: D(2026, 10, 13), is_last_of_month: false });
    expect(parts.map((p) => [p.label ?? p.part_id, p.amount])).toEqual([["base", 3092], ["Other", 108]]);
  });
  it("an edit whose part was removed (type changed) stays as a labelled one-off on a received check", () => {
    const occurrence_parts = { [key(D(2026, 10, 28))]: [{ part_id: "comm", kind: "commission", amount: 500 }] };
    const parts = received_check_parts({
      parts: [BASE], occurrence_parts, amount: 3592, date_ms: D(2026, 10, 28), is_last_of_month: true,
    });
    expect(parts.map((p) => [p.part_id ?? p.kind, p.amount])).toEqual([["base", 3092], ["commission", 500]]);
    expect(sum_parts(parts)).toBe(3592);
  });
  it("labelled history feeds the forecast (a reimbursement taken out of commission history)", () => {
    const deposits = egnyte_deposits([4000, 6000, 8000]);
    const oct = D(2026, 10, 28);
    const occurrence_parts = { [key(oct)]: [{ part_id: "base", kind: "base", amount: 3092 }, { kind: "reimbursement", amount: 3000 }] };
    const [, c] = compute_part_stats({ parts: [BASE, COMMISSION], deposits, occurrence_parts });
    // October commission becomes 8000 - 3000 = 5000 -> median of 4000, 6000(Sep?), 5000
    expect(c.typical).toBe(5000);
  });
});

describe("hook into build_expected_occurrences / placement", () => {
  const schedule = {
    frequency: "SEMI_MONTHLY", average_amount: 9999,
    first_date: Timestamp.fromMillis(D(2025, 1, 13)), last_date: Timestamp.fromMillis(D(2026, 10, 28)),
    predicted_next_date: Timestamp.fromMillis(D(2026, 11, 13)), source: "plaid",
  };
  const deposits = egnyte_deposits([4000, 6000, 8000, 10000, 12000]);
  const base_item: RecurringForExpected = { id: "inf1", kind: "inflow", schedule, payment_history: deposits };
  const span: [number, number] = [D(2026, 11, 1), D(2026, 11, 30)];

  it("parts set the expected amount per check", () => {
    const occ = build_expected_occurrences({ ...base_item, income_parts: [BASE, COMMISSION] }, ...span);
    expect(occ.map((o) => [key(o.due_date_ms), o.amount_due])).toEqual([
      ["2026-11-13", 3092], ["2026-11-28", 11092],
    ]);
  });

  it("legacy occurrence_amount_overrides still wins over parts", () => {
    const occ = build_expected_occurrences(
      { ...base_item, income_parts: [BASE, COMMISSION], occurrence_amount_overrides: { "2026-11-28": 777 } },
      ...span
    );
    expect(occ[1].amount_due).toBe(777);
    expect(occ[0].amount_due).toBe(3092);
  });

  it("an income without parts behaves exactly as before", () => {
    const a = build_expected_occurrences(base_item, ...span);
    const b = build_expected_occurrences({ ...base_item, income_parts: [] }, ...span);
    expect(b).toEqual(a);
  });

  it("attach_income_parts: received check splits the deposit, outstanding shows plan; placement carries parts", () => {
    const recurring = { ...base_item, name: "x", payments: [], removal_intervals: [], income_parts: [BASE, COMMISSION] };
    const recon = (due: number, paid: boolean, amount_paid: number): ReconciledOccurrence => ({
      occurrence_id: `inf1_${due}`, recurring_id: "inf1", due_date_ms: due, amount_due: 0, amount_paid,
      is_paid: paid, matched_transaction_id: null, matched_split_id: null, payment_date_ms: null,
    });
    const attached = attach_income_parts(
      recurring as never,
      [recon(D(2026, 11, 13), true, 3092), recon(D(2026, 11, 28), false, 0)],
      ...span
    );
    expect(attached[0].parts).toEqual([
      { part_id: "base", kind: "base", amount: 3092, sure: true },
    ]);
    expect(attached[0].sure_amount).toBe(3092);
    expect(attached[1].parts?.map((p) => p.amount)).toEqual([3092, 8000]);
    expect(attached[1].sure_amount).toBe(3092);
    const groups = place_occurrences(attached, [{ period_id: "2026M11", start_ms: span[0], end_ms: span[1] }]);
    expect(groups[0].occurrences[1].parts?.length).toBe(2);
    expect(groups[0].occurrences[1].sure_amount).toBe(3092);
  });

  it("a check with an amount set before parts keeps that total and gets labelled parts", () => {
    const recurring = {
      ...base_item, name: "x", payments: [], removal_intervals: [], income_parts: [BASE, COMMISSION],
      occurrence_amount_overrides: { "2026-11-28": 9600, "2026-11-13": 5000 },
    };
    const recon = (due: number): ReconciledOccurrence => ({
      occurrence_id: `inf1_${due}`, recurring_id: "inf1", due_date_ms: due, amount_due: 0, amount_paid: 0,
      is_paid: false, matched_transaction_id: null, matched_split_id: null, payment_date_ms: null,
    });
    const [mid, end] = attach_income_parts(recurring as never, [recon(D(2026, 11, 13)), recon(D(2026, 11, 28))], ...span);
    // month end: base 3092 + commission 6508, all sure (the user set the total)
    expect(end.parts?.map((p) => [p.part_id, p.amount, p.sure])).toEqual([["base", 3092, true], ["comm", 6508, true]]);
    expect(end.sure_amount).toBe(9600);
    // mid-month set bigger than base: the extra goes to the part that takes the rest
    expect(mid.parts?.map((p) => [p.part_id, p.amount])).toEqual([["base", 3092], ["comm", 1908]]);
    expect(sum_parts(mid.parts ?? [])).toBe(5000);
  });

  it("placement without parts emits no parts keys (output unchanged)", () => {
    const groups = place_occurrences(
      [{ occurrence_id: "a", recurring_id: "r", due_date_ms: D(2026, 11, 13), amount_due: 5, amount_paid: 0, is_paid: false }],
      [{ period_id: "2026M11", start_ms: span[0], end_ms: span[1] }]
    );
    expect("parts" in groups[0].occurrences[0]).toBe(false);
    expect("sure_amount" in groups[0].occurrences[0]).toBe(false);
  });
});
