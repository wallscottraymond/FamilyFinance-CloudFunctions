/**
 * Read-Cost-Review-Round-3 #5: derivation now loads only monthly budget periods whose periodStart
 * is in monthly_period_load_bounds(range). Proves that range is a SUPERSET of every period
 * `shape_period_derivation_deps` keeps (overlapping a window's span), for every cadence — so the
 * shaped result is identical to loading all of the user's monthly periods.
 */
jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn(), Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) } }));
import { monthly_period_load_bounds } from "../period_derivation.resolver";

const DAY = 86_400_000;
type Span = { start: number; end: number };

// Real calendar source periods (UTC), 2025–2027.
const monthly: Span[] = [], half: Span[] = [], weekly: Span[] = [];
for (let y = 2025; y <= 2027; y++) for (let m = 0; m < 12; m++) {
  monthly.push({ start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 1) - 1 });
  half.push({ start: Date.UTC(y, m, 1), end: Date.UTC(y, m, 16) - 1 }, { start: Date.UTC(y, m, 16), end: Date.UTC(y, m + 1, 1) - 1 });
}
for (let s = Date.UTC(2024, 11, 29); s < Date.UTC(2028, 0, 1); s += 7 * DAY) weekly.push({ start: s, end: s + 7 * DAY - 1 });

const overlaps = (p: Span, a: number, b: number) => !(p.end < a || p.start > b);

let seed = 3;
const r = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

it("every monthly budget period derivation keeps starts inside the load bounds (5,000 random ranges × 3 cadences)", () => {
  for (let i = 0; i < 5000; i++) {
    // A request range of 1–12 windows (derive_period_range) somewhere in 2025–2027.
    const range_start = Date.UTC(2025, 2, 1) + Math.floor(r() * 600) * DAY + (r() < 0.2 ? Math.floor(r() * DAY) : 0);
    const range_end = range_start + Math.floor(r() * 360) * DAY + DAY - 1;
    const [lo, hi] = monthly_period_load_bounds(range_start, range_end);
    for (const buckets of [monthly, half, weekly]) {
      // A window inside the range → its view buckets = source periods overlapping it → its span.
      const ws = range_start + Math.floor(r() * Math.max(1, range_end - range_start));
      const we = Math.min(range_end, ws + Math.floor(r() * 40) * DAY);
      const vb = buckets.filter((p) => overlaps(p, ws, we));
      const span = vb.length ? { start: Math.min(...vb.map((b) => b.start)), end: Math.max(...vb.map((b) => b.end)) } : { start: ws, end: we };
      // Monthly budget periods kept by shape_period_derivation_deps' in-memory filter:
      for (const p of monthly.filter((mp) => overlaps(mp, span.start, span.end))) {
        expect(p.start).toBeGreaterThanOrEqual(lo);
        expect(p.start).toBeLessThanOrEqual(hi);
      }
    }
  }
});

it("bounds are [start − 62d, end + 31d]", () => {
  expect(monthly_period_load_bounds(100 * DAY, 200 * DAY)).toEqual([38 * DAY, 231 * DAY]);
});
