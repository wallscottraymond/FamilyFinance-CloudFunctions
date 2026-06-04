/**
 * match_recurring Domain Service — Unit Tests
 *
 * Verifies the scoring (merchant 50 / amount 30 / date 20−days×2), the 50
 * threshold, settled-skip, and highest-wins selection.
 */

import {
  match_recurring,
  score_recurring_match,
  RecurringCandidate,
  RECURRING_MATCH_THRESHOLD,
} from "../match_recurring.service";

const DUE = Date.UTC(2026, 5, 20);
const DAY = 24 * 60 * 60 * 1000;

function cand(over: Partial<RecurringCandidate> = {}): RecurringCandidate {
  return {
    period_id: "p1",
    recurring_id: "o_electric",
    merchant_name: "ConEd",
    expected_amount: 100,
    due_date_ms: DUE,
    is_settled: false,
    ...over,
  };
}
const txn = (over: Partial<{ merchant_name: string | null; amount: number; date_ms: number }> = {}) => ({
  merchant_name: "ConEd Energy",
  amount: 100,
  date_ms: DUE,
  ...over,
});

describe("score_recurring_match", () => {
  it("merchant + amount + exact date → 100", () => {
    expect(score_recurring_match(txn(), cand())).toBe(100); // 50 + 30 + 20
  });

  it("merchant only → 50 (bidirectional substring)", () => {
    expect(score_recurring_match(txn({ amount: 9999, date_ms: DUE + 30 * DAY }), cand())).toBe(50);
  });

  it("amount within 10% scores; outside doesn't", () => {
    expect(score_recurring_match(txn({ merchant_name: null, amount: 109, date_ms: DUE + 30 * DAY }), cand())).toBe(30);
    expect(score_recurring_match(txn({ merchant_name: null, amount: 120, date_ms: DUE + 30 * DAY }), cand())).toBe(0);
  });

  it("date decays with distance and cuts off past 7 days", () => {
    // 2 days off → 20 - 4 = 16 (merchant null, amount off)
    expect(score_recurring_match(txn({ merchant_name: null, amount: 9999, date_ms: DUE + 2 * DAY }), cand())).toBe(16);
    // 8 days off → 0
    expect(score_recurring_match(txn({ merchant_name: null, amount: 9999, date_ms: DUE + 8 * DAY }), cand())).toBe(0);
  });
});

describe("match_recurring", () => {
  it("matches the best candidate over the threshold", () => {
    const r = match_recurring(txn(), [cand()]);
    expect(r.matched).toBe(true);
    expect(r.recurring_id).toBe("o_electric");
    expect(r.period_id).toBe("p1");
    expect(r.score).toBe(100);
  });

  it("no match when nothing clears the threshold", () => {
    // amount-only 30 < 50 threshold
    const r = match_recurring(
      txn({ merchant_name: null, amount: 100, date_ms: DUE + 30 * DAY }),
      [cand()]
    );
    expect(r.matched).toBe(false);
    expect(r.recurring_id).toBeNull();
    expect(RECURRING_MATCH_THRESHOLD).toBe(50);
  });

  it("skips settled candidates", () => {
    const r = match_recurring(txn(), [cand({ is_settled: true })]);
    expect(r.matched).toBe(false);
  });

  it("picks the highest-scoring among several", () => {
    // weak: merchant only (50); strong: merchant + amount + date (100)
    const weak = cand({ period_id: "p_weak", recurring_id: "o_weak", expected_amount: 0, due_date_ms: null });
    const strong = cand({ period_id: "p_strong", recurring_id: "o_strong" });
    const r = match_recurring(txn(), [weak, strong]);
    expect(r.recurring_id).toBe("o_strong");
  });

  it("is deterministic", () => {
    expect(match_recurring(txn(), [cand()])).toEqual(match_recurring(txn(), [cand()]));
  });
});
