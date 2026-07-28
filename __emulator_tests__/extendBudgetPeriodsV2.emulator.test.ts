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

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import { run_recurring_budget_period_extension } from '../src/functions/budgets/orchestration/scheduled/extendRecurringBudgetPeriods';

const bid = () => `b_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
};

/* eslint-disable @typescript-eslint/naming-convention */
async function seedSource(id: string, start: Date, end: Date) {
  await db.collection('source_periods').doc(id).set({
    periodId: id,
    type: 'bi_monthly',
    startDate: Timestamp.fromDate(start),
    endDate: Timestamp.fromDate(end),
    year: start.getUTCFullYear(),
    index: 0,
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

describe('run_recurring_budget_period_extension (v2, emulator)', () => {
  afterAll(async () => {
    await db.terminate();
  });

  it('extends a bi_monthly budget with bi_monthly PRIME periods + preserves existing spent', async () => {
    const userId = uid();
    const budgetId = bid();

    await db.collection('budgets').doc(budgetId).set({
      /* eslint-disable @typescript-eslint/naming-convention */
      budgetType: 'recurring',
      isOngoing: true,
      isActive: true,
      period: 'bi_monthly',
      amount: 200,
      name: 'BiMo',
      categoryIds: [],
      createdBy: userId,
      access: { createdBy: userId },
      groupId: null,
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    // Four bi_monthly source periods inside the rolling window (starts ~10 days out).
    const base = addDays(new Date(), 10);
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
    await db.collection('budget_periods').doc(existingId).set({
      /* eslint-disable @typescript-eslint/naming-convention */
      id: existingId,
      budgetId,
      periodId: sourceIds[0],
      sourcePeriodId: sourceIds[0],
      periodType: 'bi_monthly',
      allocatedAmount: 200,
      spent: 50,
      isActive: true,
      periodStart: Timestamp.fromDate(base),
      periodEnd: Timestamp.fromDate(addDays(base, 14)),
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    const res = await run_recurring_budget_period_extension(db, Timestamp.now());
    expect(res.totalPeriodsCreated).toBeGreaterThan(0);

    // (2) existing spend preserved — NOT reset to 0.
    const existing = (await db.collection('budget_periods').doc(existingId).get()).data()!;
    expect(existing.spent).toBe(50);

    // (1) the other three sources got bi_monthly PRIME periods, allocated 1:1.
    const periods = (
      await db.collection('budget_periods').where('budgetId', '==', budgetId).get()
    ).docs.map((d) => d.data());
    const biMonthly = periods.filter((p) => p.periodType === 'bi_monthly');
    expect(biMonthly.length).toBe(4); // 1 existing + 3 new
    const created = biMonthly.filter((p) => p.id !== existingId);
    expect(created.length).toBe(3);
    created.forEach((p) => expect(p.allocatedAmount).toBe(200)); // prime = 1:1
  });
});
