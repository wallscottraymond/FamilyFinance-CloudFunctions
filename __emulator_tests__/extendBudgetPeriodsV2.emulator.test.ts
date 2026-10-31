/**
 * Emulator Integration — scheduled budget-period extension migrated to the v2
 * generator (single source of truth for prime cadence).
 *
 * Proves the two properties that matter after the migration:
 *  1. a bi_monthly recurring budget extends with real bi_monthly PRIME periods
 *     (the legacy path clamped bi_monthly → monthly-prime); and
 *  2. an EXISTING period's `spent` is preserved — the extender never overwrites
 *     periods that already exist (save_batch is a set()).
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { run_recurring_budget_period_extension } from "../src/functions/budgets/orchestration/scheduled/extendRecurringBudgetPeriods";

const bid = () => `b_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
};

/* eslint-disable @typescript-eslint/naming-convention */
async function seedSource(id: string, start: Date, end: Date) {
  await db.collection("source_periods").doc(id).set({
    periodId: id,
    type: "bi_monthly",
    startDate: Timestamp.fromDate(start),
    endDate: Timestamp.fromDate(end),
    year: start.getUTCFullYear(),
    index: 0,
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

describe("run_recurring_budget_period_extension (v2, emulator)", () => {
  afterAll(async () => {
    await db.terminate();
  });

  it("extends a bi_monthly budget with bi_monthly PRIME periods + preserves existing spent", async () => {
    const userId = uid();
    const budgetId = bid();

    await db.collection("budgets").doc(budgetId).set({
      /* eslint-disable @typescript-eslint/naming-convention */
      budgetType: "recurring",
      isOngoing: true,
      isActive: true,
      period: "bi_monthly",
      amount: 200,
      name: "BiMo",
      categoryIds: [],
      createdBy: userId,
      access: { createdBy: userId },
      groupId: null,
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    // Deterministic (review round 3): an injected clock in a year no other suite seeds (2046),
    // and the run scoped to this budget — the shared emulator's other budgets / source periods
    // never enter it. Four bi_monthly source periods inside the rolling window (~10 days out).
    const NOW = new Date(Date.UTC(2046, 2, 10, 12));
    const base = addDays(NOW, 10);
    const sourceIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const s = addDays(base, i * 15);
      const e = addDays(s, 14);
      const id = `bm_${budgetId}_${i}`;
      await seedSource(id, s, e);
      sourceIds.push(id);
    }

    // Pre-existing period for source[0] with spent = 50 — must survive untouched.
    const existingId = `${budgetId}_${sourceIds[0]}`;
    await db.collection("budget_periods").doc(existingId).set({
      /* eslint-disable @typescript-eslint/naming-convention */
      id: existingId,
      budgetId,
      periodId: sourceIds[0],
      sourcePeriodId: sourceIds[0],
      periodType: "bi_monthly",
      allocatedAmount: 200,
      spent: 50,
      isActive: true,
      periodStart: Timestamp.fromDate(base),
      periodEnd: Timestamp.fromDate(addDays(base, 14)),
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    const res = await run_recurring_budget_period_extension(db, Timestamp.fromDate(NOW), { budget_ids: [budgetId] });
    expect(res.budgetsProcessed).toBe(1);
    expect(res.totalPeriodsCreated).toBe(3);

    // (2) existing spend preserved — NOT reset to 0.
    const existing = (await db.collection("budget_periods").doc(existingId).get()).data()!;
    expect(existing.spent).toBe(50);

    // (1) the other three sources got bi_monthly PRIME periods, allocated 1:1.
    const periods = (
      await db.collection("budget_periods").where("budgetId", "==", budgetId).get()
    ).docs.map((d) => d.data());
    const biMonthly = periods.filter((p) => p.periodType === "bi_monthly");
    expect(biMonthly.length).toBe(4); // 1 existing + 3 new
    const created = biMonthly.filter((p) => p.id !== existingId);
    expect(created.length).toBe(3);
    created.forEach((p) => expect(p.allocatedAmount).toBe(200)); // prime = 1:1
  });

  // Code-Health-Review batch 6 verify #2: the 45-day lookback must not create periods before the
  // budget's first period, and a stored far-edge monthly record the new weeks complete is re-priced
  // (unless the user edited it). Its own year (2047), its own source periods, scoped run.
  it("weekly budget: no periods before its start; a short future month is re-priced, an edited one kept", async () => {
    const userId = uid();
    const budgetId = bid();
    const U = (m: number, d: number, end = false) =>
      Timestamp.fromMillis(Date.UTC(2047, m - 1, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0));
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection("budgets").doc(budgetId).set({
      budgetType: "recurring", isOngoing: true, isActive: true, period: "weekly", amount: 70,
      name: "Wk", categoryIds: [], createdBy: userId, userId, access: { createdBy: userId },
      startDate: U(6, 10), // Mon Jun 10 2047 → its first week starts Sun Jun 9
    });
    const src = async (id: string, type: string, s: Timestamp, e: Timestamp) =>
      db.collection("source_periods").doc(`${budgetId}_${id}`).set({ periodId: `${budgetId}_${id}`, type, startDate: s, endDate: e, year: 2047, index: 0 });
    // Weeks Sun May 26 → Sat Jul 6 2047, plus May, June and July.
    const weeks: Array<[number, number, number, number]> = [[5, 26, 6, 1], [6, 2, 6, 8], [6, 9, 6, 15], [6, 16, 6, 22], [6, 23, 6, 29], [6, 30, 7, 6]];
    for (const [sm, sd, em, ed] of weeks) await src(`W${sm}${sd}`, "weekly", U(sm, sd), U(em, ed, true));
    await src("M05", "monthly", U(5, 1), U(5, 31, true));
    await src("M06", "monthly", U(6, 1), U(6, 30, true));
    await src("M07", "monthly", U(7, 1), U(7, 31, true));
    // A stored July record priced only for Jul 1–6 ($60) — the old far edge — and an edited one.
    const julyId = `${budgetId}_${budgetId}_M07`;
    await db.collection("budget_periods").doc(julyId).set({
      id: julyId, budgetId, periodId: `${budgetId}_M07`, sourcePeriodId: `${budgetId}_M07`, periodType: "monthly",
      allocatedAmount: 60, spent: 5, rolledOverAmount: 0, isActive: true, periodStart: U(7, 1), periodEnd: U(7, 31, true),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    const NOW = new Date(Date.UTC(2047, 5, 20, 12));
    await run_recurring_budget_period_extension(db, Timestamp.fromDate(NOW), { budget_ids: [budgetId] });
    const docs = (await db.collection("budget_periods").where("budgetId", "==", budgetId).get()).docs.map((d) => d.data());
    // Nothing before the budget's first week (Sun Jun 9): no May record, no May 26 / Jun 2 weeks.
    expect(docs.filter((d) => d.periodEnd.toMillis() < U(6, 9).toMillis()).map((d) => d.id)).toEqual([]);
    // July re-priced to the whole month ($10/day × 31), spend kept in remaining.
    const july = docs.find((d) => d.id === julyId)!;
    expect(july.allocatedAmount).toBeCloseTo(310, 2);
    expect(july.remaining).toBeCloseTo(305, 2);
    expect(july.spent).toBe(5);
  });
});
