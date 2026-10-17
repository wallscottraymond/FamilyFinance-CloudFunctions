/**
 * Top-25 #2 — the derive's month rule for removed / restored / paused bills (D26, b6a8281), pure.
 * Cases (a)–(c) from review round 3, with the exact groups and occurrences per cadence, and the
 * boundary payment counted exactly once (paid OR budget spend, never both, never neither).
 * 2026 calendar: Oct 1 2026 is a Thursday → the week Sun Sep 27 – Sat Oct 3 straddles it.
 */
import { BillSpec, by_bucket, derive, payment_counts, round2 } from "./derive_fixture";

const U = (m: number, d: number, h = 12) => Date.UTC(2026, m - 1, d, h);
const W_SEP27 = `W_${Date.UTC(2026, 8, 27)}`;
const W_OCT11 = `W_${Date.UTC(2026, 9, 11)}`;
const W_OCT4 = `W_${Date.UTC(2026, 9, 4)}`;
const occ = (r: ReturnType<typeof derive>, id: string, period: string) =>
  (r.bills.find((b) => b.recurring_id === id)?.groups.find((g) => g.period_id === period)?.occurrences ?? [])
    .map((o) => [new Date(o.due_ms).toISOString().slice(0, 10), o.paid]);
const visible = (r: ReturnType<typeof derive>, id: string, period: string) =>
  !!r.bills.find((b) => b.recurring_id === id)?.groups.some((g) => g.period_id === period);
const SEP_OCT = { start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 10, 1) - 1 };

describe("derive month rule — A2 cases (pure)", () => {
  it("(a) removed from Oct 1, paid Sep 29: the straddling week shows it PAID; counted once", () => {
    const bill: BillSpec = {
      id: "a", frequency: "monthly", amount: 100, anchor_ms: U(10, 29), first_ms: U(1, 29),
      removal_intervals: [{ from_ms: Date.UTC(2026, 9, 1), to_ms: null, mode: "going_forward" }],
      payments: [{ id: "p_aug", date_ms: U(8, 29), amount: 100 }, { id: "p_sep", date_ms: U(9, 29), amount: 100 }],
    };
    const w = derive([bill], "weekly", SEP_OCT);
    expect(occ(w, "a", W_SEP27)).toEqual([["2026-09-29", true]]);
    expect(visible(w, "a", W_OCT4)).toBe(false); // fully removed week
    expect(by_bucket(w, "a").get(W_SEP27)?.ee).toBe(0); // not also budget spend
    expect(payment_counts(w, [bill]).get("p_sep")).toBe(1);
    // Twice a month: Sep 16–30 paid; both Oct halves hidden.
    const bm = derive([bill], "bi_monthly", SEP_OCT);
    expect(occ(bm, "a", "BM_2026_8_B")).toEqual([["2026-09-29", true]]);
    expect([visible(bm, "a", "BM_2026_9_A"), visible(bm, "a", "BM_2026_9_B")]).toEqual([false, false]);
    // Monthly: Sep paid, Oct hidden (unchanged from before the fix).
    const m = derive([bill], "monthly", SEP_OCT);
    expect(occ(m, "a", "M_2026_8")).toEqual([["2026-09-29", true]]);
    expect(visible(m, "a", "M_2026_9")).toBe(false);
  });

  it("(b) removed Sep 1, restored Oct 20: the Oct 12 week and the Oct 1–15 half show the bill; Sep stays removed", () => {
    const bill: BillSpec = {
      id: "b", frequency: "monthly", amount: 40, anchor_ms: U(10, 12), first_ms: U(1, 12),
      removal_intervals: [{ from_ms: Date.UTC(2026, 8, 1), to_ms: U(10, 20, 9), mode: "going_forward" }],
      payments: [{ id: "p_sep", date_ms: U(9, 12), amount: 40 }, { id: "p_oct", date_ms: U(10, 12), amount: 40 }],
    };
    const w = derive([bill], "weekly", SEP_OCT);
    expect(occ(w, "b", W_OCT11)).toEqual([["2026-10-12", true]]);
    expect(visible(w, "b", `W_${Date.UTC(2026, 8, 6)}`)).toBe(false); // Sep 12 week: removed month
    expect(by_bucket(w, "b").get(`W_${Date.UTC(2026, 8, 6)}`)?.ee).toBe(40); // its payment is budget spend
    const counts = payment_counts(w, [bill]);
    expect([counts.get("p_sep"), counts.get("p_oct")]).toEqual([0, 1]);
    const bm = derive([bill], "bi_monthly", SEP_OCT);
    expect(occ(bm, "b", "BM_2026_9_A")).toEqual([["2026-10-12", true]]);
    expect(visible(bm, "b", "BM_2026_8_A")).toBe(false);
    const m = derive([bill], "monthly", SEP_OCT);
    expect(occ(m, "b", "M_2026_9")).toEqual([["2026-10-12", true]]);
    expect(visible(m, "b", "M_2026_8")).toBe(false);
  });

  it("(c) paused Sep 1 → Oct 2, due Sep 29: the straddling week lists the bill with NO occurrence (as the monthly view)", () => {
    const bill: BillSpec = {
      id: "c", frequency: "monthly", amount: 25, anchor_ms: U(10, 29), first_ms: U(1, 29),
      removal_intervals: [{ from_ms: Date.UTC(2026, 8, 1), to_ms: U(10, 2, 9), mode: "paused" }],
      payments: [{ id: "p_aug", date_ms: U(8, 29), amount: 25 }],
    };
    const w = derive([bill], "weekly", SEP_OCT);
    expect(visible(w, "c", W_SEP27)).toBe(true);
    expect(occ(w, "c", W_SEP27)).toEqual([]); // no expected unpaid bill in a paused month
    const g = w.bills[0].groups.find((x) => x.period_id === W_SEP27)!;
    expect([g.count_in_period, g.total_due]).toEqual([0, 0]);
    // Monthly: September is hidden, October shows its Oct 29 occurrence.
    const m = derive([bill], "monthly", SEP_OCT);
    expect(visible(m, "c", "M_2026_8")).toBe(false);
    expect(occ(m, "c", "M_2026_9")).toEqual([["2026-10-29", false]]);
  });

  it("every cadence totals the same paid / due for the removed span (monthly = Σ weekly = Σ halves)", () => {
    const bill: BillSpec = {
      id: "t", frequency: "monthly", amount: 100, anchor_ms: U(10, 29), first_ms: U(1, 29),
      removal_intervals: [{ from_ms: Date.UTC(2026, 9, 1), to_ms: null, mode: "going_forward" }],
      payments: [{ id: "p_sep", date_ms: U(9, 29), amount: 100 }],
    };
    const total = (r: ReturnType<typeof derive>) => {
      const gs = r.bills[0].groups;
      return [round2(gs.reduce((s, g) => s + g.total_paid, 0)), round2(gs.reduce((s, g) => s + g.total_due, 0))];
    };
    const win = { start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 31, 23, 59, 59, 999) };
    const m = total(derive([bill], "monthly", win));
    expect(m).toEqual([100, 100]);
    // Weekly buckets extend past the window edges (Aug 30 / Nov 7) but hold no other occurrence.
    expect(total(derive([bill], "weekly", win))).toEqual(m);
    expect(total(derive([bill], "bi_monthly", win))).toEqual(m);
  });
});

describe("D28 — an early payment before a removal / end cut-off counts (pure)", () => {
  // Due the 1st; paid Sep 1 on time and Sep 29 EARLY for Oct 1; removed (or ended / paused) from Oct 1.
  const make = (mode: "going_forward" | "paused"): BillSpec => ({
    id: "e", frequency: "monthly", amount: 100, anchor_ms: U(11, 1), first_ms: U(1, 1),
    removal_intervals: [{ from_ms: Date.UTC(2026, 9, 1), to_ms: mode === "paused" ? Date.UTC(2026, 10, 1) : null, mode }],
    payments: [{ id: "p_sep1", date_ms: U(9, 1), amount: 100 }, { id: "p_sep29", date_ms: U(9, 29), amount: 100 }],
  });
  for (const mode of ["going_forward", "paused"] as const) {
    it(`${mode}: paid in Sep in every cadence (one window or a range), Oct hidden, counted exactly once, never budget spend`, () => {
      const bill = make(mode);
      const SEP = { start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 1) - 1 };
      for (const w of [SEP, SEP_OCT]) {
        const m = derive([bill], "monthly", w);
        expect(occ(m, "e", "M_2026_8")).toEqual([["2026-09-01", true], ["2026-09-29", true]]);
        expect(visible(m, "e", "M_2026_9")).toBe(false);
        expect(payment_counts(m, [bill]).get("p_sep29")).toBe(1);
        expect(by_bucket(m, "e").get("M_2026_8")?.ee).toBe(0);
        const bm = derive([bill], "bi_monthly", w);
        expect(occ(bm, "e", "BM_2026_8_B")).toEqual([["2026-09-29", true]]);
        expect(payment_counts(bm, [bill]).get("p_sep29")).toBe(1);
      }
      const wk = derive([bill], "weekly", SEP_OCT);
      expect(occ(wk, "e", W_SEP27)).toEqual([["2026-09-29", true]]);
      expect(payment_counts(wk, [bill]).get("p_sep29")).toBe(1);
      expect(by_bucket(wk, "e").get(W_SEP27)?.ee).toBe(0);
      // The Oct view alone: hidden, nothing counted there.
      const oct = derive([bill], "monthly", { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 10, 1) - 1 });
      expect(visible(oct, "e", "M_2026_9")).toBe(false);
    });
  }

  it("not early (paid on/after the due day in the removed month) or the payment's month removed too → unchanged", () => {
    const late: BillSpec = { ...make("going_forward"), payments: [{ id: "p_oct2", date_ms: U(10, 2), amount: 100 }] };
    const m = derive([late], "monthly", SEP_OCT);
    expect(visible(m, "e", "M_2026_9")).toBe(false);
    expect(by_bucket(m, "e").get("M_2026_9")?.ee).toBe(100); // released → budget spend, as before
    const both: BillSpec = { ...make("going_forward"), removal_intervals: [{ from_ms: Date.UTC(2026, 8, 1), to_ms: null, mode: "going_forward" }] };
    expect(visible(derive([both], "monthly", SEP_OCT), "e", "M_2026_8")).toBe(false);
  });

  it("no removal: a cross-month early payment is untouched (no look-ahead for live bills)", () => {
    const live: BillSpec = { ...make("going_forward"), removal_intervals: [] };
    const SEP = { start: Date.UTC(2026, 8, 1), end: Date.UTC(2026, 9, 1) - 1 };
    expect(occ(derive([live], "monthly", SEP), "e", "M_2026_8")).toEqual([["2026-09-01", true]]);
  });
});
