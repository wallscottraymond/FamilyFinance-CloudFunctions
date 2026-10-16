import { should_hide_v1, should_hide_v2, target_hidden, HidingRecord } from "../transfer_hiding.service";

const XFER = "TRANSFER_OUT_ACCOUNT_TRANSFER";
const CC = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const rec = (o: Partial<HidingRecord>): HidingRecord => ({
  kind: "o", plaid_detailed_category: XFER, transaction_ids: [], is_hidden: false, v2: true, ...o,
});
const ids = (n: number, p = "t") => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("transfer hiding", () => {
  it("v1 (old records) is today's any-one rule; card payments never hidden", () => {
    expect(should_hide_v1(XFER, ["a", "b"], new Set(["b"]))).toBe(true);
    expect(should_hide_v1(XFER, ["a"], new Set())).toBe(false);
    expect(should_hide_v1(CC, ["a"], new Set(["a"]))).toBe(false);
    expect(target_hidden(rec({ v2: false, kind: "i", plaid_detailed_category: CC }), new Set(), new Set())).toBe(false);
  });

  it("24-month stream, 6 in-window legs all paired → hidden (in-window denominator)", () => {
    const all = ids(24);
    const window = new Set(all.slice(18));
    const internal = new Set(all.slice(18));
    expect(should_hide_v2(rec({ transaction_ids: all }), window, internal)).toBe(true);
    // The naive whole-stream ratio (6/24) would have kept it visible forever.
    expect(6 / 24).toBeLessThan(0.5);
  });

  it("one coincidental pair never hides a v2 stream (≥2 paired AND ≥50%)", () => {
    const t = ids(6);
    expect(should_hide_v2(rec({ transaction_ids: t }), new Set(t), new Set(["t0"]))).toBe(false);
    expect(should_hide_v2(rec({ transaction_ids: ["t0"] }), new Set(["t0"]), new Set(["t0"]))).toBe(false);
    expect(should_hide_v2(rec({ transaction_ids: t }), new Set(t), new Set(["t0", "t1", "t2"]))).toBe(true);
  });

  it("hysteresis: hidden stays hidden until < 25% pair; no in-window legs → unchanged", () => {
    const t = ids(8);
    const w = new Set(t);
    expect(should_hide_v2(rec({ transaction_ids: t, is_hidden: true }), w, new Set(["t0", "t1"]))).toBe(true); // 25%
    expect(should_hide_v2(rec({ transaction_ids: t, is_hidden: true }), w, new Set(["t0"]))).toBe(false); // 12.5%
    expect(should_hide_v2(rec({ transaction_ids: t, is_hidden: true }), new Set(), new Set())).toBe(true);
    expect(should_hide_v2(rec({ transaction_ids: t, is_hidden: false }), new Set(), new Set())).toBe(false);
  });

  it("v2 card-payment inflow always hidden; the paying outflow never", () => {
    expect(should_hide_v2(rec({ kind: "i", plaid_detailed_category: CC }), new Set(), new Set())).toBe(true);
    expect(should_hide_v2(rec({ kind: "i", plaid_detailed_category: CC, is_hidden: true }), new Set(), new Set())).toBe(true);
    expect(should_hide_v2(rec({ kind: "o", plaid_detailed_category: CC }), new Set(), new Set())).toBe(false);
  });

  it("30 simulated days, borderline stream with the window sliding → at most the first change (naive rule flaps)", () => {
    // Legs every 35 days; every other leg pairs → 5 or 6 legs in a 180-day window, 40–60% paired.
    const DAY = 86400000;
    const legs = Array.from({ length: 14 }, (_, i) => ({ id: `l${i}`, day: i * 35 }));
    const internal = new Set(legs.filter((_, i) => i % 2 === 0).map((l) => l.id));
    let hidden = false;
    let flips = 0;
    let naive_hidden = false;
    let naive_flips = 0;
    for (let d = 300; d < 420; d++) { // 120 days (the first 30 are the R6 window)
      const window = new Set(legs.filter((l) => l.day <= d && l.day > d - 180).map((l) => l.id));
      const next = should_hide_v2(rec({ transaction_ids: legs.map((l) => l.id), is_hidden: hidden }), window, internal);
      if (next !== hidden && d > 300) flips++;
      if (d === 330) expect(flips).toBeLessThanOrEqual(1); // first 30 simulated days
      hidden = next;
      const in_w = [...window];
      const ratio = in_w.filter((x) => internal.has(x)).length / Math.max(1, in_w.length);
      const naive = ratio >= 0.5;
      if (naive !== naive_hidden && d > 300) naive_flips++;
      naive_hidden = naive;
      void DAY;
    }
    expect(flips).toBeLessThanOrEqual(1); // R6: no hide/unhide after the first
    expect(naive_flips).toBeGreaterThanOrEqual(2); // proves the window really oscillates around 50%
  });
});
