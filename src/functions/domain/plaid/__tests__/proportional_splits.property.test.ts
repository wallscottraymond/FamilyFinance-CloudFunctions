/**
 * calculate_proportional_splits — a pending transaction posting for a different amount: the
 * scaled splits ALWAYS add up to the posted amount to the cent, and keep their proportions.
 */
import { calculate_proportional_splits } from "../transaction_sync.service";

it("scaled splits always add up to the posted amount (5,000 random cases)", () => {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(r() * 5);
    const amounts = Array.from({ length: n }, () => Math.round(r() * 20000) / 100);
    const old_total = amounts.reduce((a, b) => a + b, 0);
    const new_total = Math.round(r() * 30000) / 100;
    const splits = amounts.map((amount, k) => ({ split_id: `s${k}`, amount })) as never;
    const out = calculate_proportional_splits(splits, old_total, new_total) as Array<{ amount: number }>;
    const sum = out.reduce((t, s) => t + Math.round(s.amount * 100), 0);
    expect([i, sum]).toEqual([i, Math.round(new_total * 100)]);
    // proportions kept: each split within a cent or two of its exact share
    out.forEach((s, k) => {
      const exact = old_total === 0 ? new_total / n : (amounts[k] / old_total) * new_total;
      expect(Math.abs(s.amount - exact)).toBeLessThan(0.03 * n);
    });
  }
});
