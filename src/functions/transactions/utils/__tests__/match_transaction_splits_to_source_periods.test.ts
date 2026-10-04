/**
 * Read-Cost-Review-Round-3 (Q4): the source-period lookup now reads only periods whose
 * startDate ∈ [min(date) − 31d, max(date)] instead of the whole collection. Proves the
 * matched period ids are IDENTICAL to the old full-scan behavior, and that the read is bounded.
 */
import { Timestamp } from "firebase-admin/firestore";

const DAY = 24 * 60 * 60 * 1000;

// ---- A real-shaped source_periods set (UTC; end = next start − 1ms), 2025–2027 ----
type P = { id: string; type: string; startDate: Timestamp; endDate: Timestamp };
const periods: P[] = [];
for (let y = 2025; y <= 2027; y++) {
  for (let m = 0; m < 12; m++) {
    const s = Date.UTC(y, m, 1), mid = Date.UTC(y, m, 16), e = Date.UTC(y, m + 1, 1);
    periods.push({ id: `${y}M${m}`, type: "monthly", startDate: Timestamp.fromMillis(s), endDate: Timestamp.fromMillis(e - 1) });
    periods.push({ id: `${y}BM${m}A`, type: "bi_monthly", startDate: Timestamp.fromMillis(s), endDate: Timestamp.fromMillis(mid - 1) });
    periods.push({ id: `${y}BM${m}B`, type: "bi_monthly", startDate: Timestamp.fromMillis(mid), endDate: Timestamp.fromMillis(e - 1) });
  }
}
for (let s = Date.UTC(2024, 11, 29); s < Date.UTC(2028, 0, 1); s += 7 * DAY) {
  periods.push({ id: `W${s}`, type: "weekly", startDate: Timestamp.fromMillis(s), endDate: Timestamp.fromMillis(s + 7 * DAY - 1) });
}

// ---- Fake Firestore: applies startDate range filters; counts docs read ----
const reads = { docs: 0, queries: [] as string[] };
function query(filters: Array<[string, string, Timestamp]>) {
  return {
    where: (f: string, op: string, v: Timestamp) => query([...filters, [f, op, v]]),
    orderBy: () => query(filters),
    get: async () => {
      reads.queries.push(filters.map(([f, op, v]) => `${f}${op}${v.toDate().toISOString()}`).join(" & "));
      const docs = periods
        .filter((p) => filters.every(([f, op, v]) => {
          const x = (p as unknown as Record<string, Timestamp>)[f].toMillis();
          return op === ">=" ? x >= v.toMillis() : op === "<=" ? x <= v.toMillis() : true;
        }))
        .sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis())
        .map((p) => ({ id: p.id, data: () => p }));
      reads.docs += docs.length;
      return { size: docs.length, docs };
    },
  };
}
jest.mock("../../../../index", () => ({ db: { collection: () => query([]) } }));

import { match_transaction_splits_to_source_periods } from "../match_transaction_splits_to_source_periods";

/** The OLD behavior: match each txn date against EVERY period. */
function legacy_ids(date_ms: number) {
  const m = periods.filter((p) => date_ms >= p.startDate.toMillis() && date_ms <= p.endDate.toMillis());
  return {
    monthlyPeriodId: m.find((p) => p.type === "monthly")?.id ?? null,
    weeklyPeriodId: m.find((p) => p.type === "weekly")?.id ?? null,
    biWeeklyPeriodId: m.find((p) => p.type === "bi_monthly")?.id ?? null,
  };
}

const txn = (date_ms: number) =>
  ({ transactionDate: Timestamp.fromMillis(date_ms), splits: [{ id: "s1", amount: 1 }] }) as never;

beforeAll(() => jest.spyOn(console, "log").mockImplementation(() => undefined));

it("matches the old full-scan result for 2,000 random dates (incl. month / half / week edges)", async () => {
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let batch = 0; batch < 100; batch++) {
    const base = Date.UTC(2025, 1, 1) + Math.floor(r() * 700) * DAY;
    const dates = Array.from({ length: 20 }, () => {
      const d = base + Math.floor(r() * 40) * DAY; // a sync spans up to ~40 days
      return r() < 0.15 ? d + DAY - 1 : d; // some at the last ms of a day
    });
    const out = (await match_transaction_splits_to_source_periods(dates.map(txn))) as unknown as Array<{ splits: Array<Record<string, unknown>> }>;
    out.forEach((t, i) => {
      const { monthlyPeriodId, weeklyPeriodId, biWeeklyPeriodId } = t.splits[0];
      expect({ monthlyPeriodId, weeklyPeriodId, biWeeklyPeriodId }).toEqual(legacy_ids(dates[i]));
    });
  }
});

it("reads only nearby periods, not the whole collection", async () => {
  reads.docs = 0;
  reads.queries = [];
  await match_transaction_splits_to_source_periods([txn(Date.UTC(2026, 9, 1)), txn(Date.UTC(2026, 9, 3))]);
  expect(reads.queries).toHaveLength(1);
  expect(reads.docs).toBeLessThan(20); // was every period (here 265; ~980 in prod)
  expect(periods.length).toBeGreaterThan(250); // fixture: 3 years of monthly + bi-monthly + weekly
});

it("a sync whose dates span a whole year still matches correctly (bounded by the span)", async () => {
  const dates = [Date.UTC(2026, 0, 2), Date.UTC(2026, 11, 30)];
  const out = (await match_transaction_splits_to_source_periods(dates.map(txn))) as unknown as Array<{ splits: Array<Record<string, unknown>> }>;
  expect(out[0].splits[0].monthlyPeriodId).toBe("2026M0");
  expect(out[1].splits[0].monthlyPeriodId).toBe("2026M11");
});
