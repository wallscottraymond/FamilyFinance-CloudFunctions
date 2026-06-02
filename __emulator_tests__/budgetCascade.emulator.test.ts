/**
 * Emulator Integration Tests — v2 Budget CRUD Cascade Handlers
 *
 * Exercises the layered-architecture cascade orchestrators directly against the
 * Firestore emulator (no functions emulator needed — we invoke the handlers and
 * assert the resulting Firestore state). Covers the four CRUD cascades:
 *
 *   1. process_budget_created  → generates budget_periods from source_periods
 *   2. process_budget_updated  → re-allocates periods IN PLACE on amount change
 *                                (preserves notes/checklist + historical)
 *   3. process_budget_updated  → propagates a rename to current+future periods
 *   4. process_budget_deleted  → deletes periods + reassigns transaction splits
 *
 * Prereqs: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import {
  process_budget_created_orchestrator,
  process_budget_updated_orchestrator,
  process_budget_deleted_orchestrator,
} from '../src/functions/orchestrators/budgets';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const bid = () => `b_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(id: string, userId: string, fields: Record<string, unknown> = {}) {
  await db.collection('budgets').doc(id).set({
    id,
    userId,
    createdBy: userId,
    groupIds: [],
    isActive: true,
    name: 'Test Budget',
    amount: 100,
    categoryIds: [],
    period: 'monthly',
    budgetType: 'recurring',
    isOngoing: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...fields,
  });
}

async function seedSourcePeriod(
  id: string,
  startISO: string,
  endISO: string,
  type: 'monthly' | 'weekly' | 'bi_monthly' = 'monthly'
) {
  await db.collection('source_periods').doc(id).set({
    periodId: id,
    type,
    startDate: Timestamp.fromDate(new Date(startISO)),
    endDate: Timestamp.fromDate(new Date(endISO)),
    year: 2026,
    index: 0,
    isCurrent: false,
    metadata: { weekStartDay: 0 },
  });
}

async function seedPeriod(
  id: string,
  budgetId: string,
  userId: string,
  startISO: string,
  endISO: string,
  fields: Record<string, unknown> = {}
) {
  await db.collection('budget_periods').doc(id).set({
    id,
    budgetId,
    userId,
    groupIds: [],
    periodId: id,
    sourcePeriodId: id,
    periodType: 'monthly',
    periodStart: Timestamp.fromDate(new Date(startISO)),
    periodEnd: Timestamp.fromDate(new Date(endISO)),
    allocatedAmount: 100,
    originalAmount: 100,
    spent: 0,
    isActive: true,
    budgetName: 'Test Budget',
    checklistItems: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...fields,
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

async function periodsFor(budgetId: string) {
  const snap = await db.collection('budget_periods').where('budgetId', '==', budgetId).get();
  return snap.docs.map((d) => d.data());
}

// Date helpers relative to "today" (cutoff is start of today UTC).
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

describe('Budget CRUD Cascades (emulator)', () => {
  afterAll(async () => {
    // Release the Firestore client so Jest exits cleanly.
    await db.terminate();
  });

  describe('process_budget_created', () => {
    it('generates one budget_period per overlapping source period', async () => {
      const userId = uid();
      const budgetId = bid();
      await seedBudget(budgetId, userId, { name: 'Groceries', amount: 300 });
      await seedSourcePeriod(`${budgetId}_2026M06`, '2026-06-01', '2026-06-30');
      await seedSourcePeriod(`${budgetId}_2026M07`, '2026-07-01', '2026-07-31');
      await seedSourcePeriod(`${budgetId}_2026M08`, '2026-08-01', '2026-08-31');

      await process_budget_created_orchestrator(ctx(), {
        budget_id: budgetId,
        user_id: userId,
        group_ids: [],
        budget_name: 'Groceries',
        amount: 300,
        cadence: 'monthly',
        start_ms: new Date('2026-06-01').getTime(),
        generation_end_ms: new Date('2026-09-01').getTime(),
        is_recurring: true,
        claims: [],
        everything_else_budget_id: null,
      });

      const periods = await periodsFor(budgetId);
      expect(periods.length).toBe(3);
      // monthly budget → monthly source period = 1:1 allocation
      periods.forEach((p) => expect(p.allocatedAmount).toBe(300));

      // activePeriodRange written back onto the budget
      const budget = (await db.collection('budgets').doc(budgetId).get()).data();
      expect(budget?.activePeriodRange?.startPeriod).toBeDefined();
    });

    it('writes a prime/non-prime overlap breakdown for converted periods', async () => {
      const userId = uid();
      const budgetId = bid();
      await seedBudget(budgetId, userId, { name: 'Groceries', amount: 300 });
      // Unique Mar/Apr 2027 window so leftover source periods from sibling tests
      // (source_periods are global + matched by date) don't bleed in.
      // Two prime monthly periods + one weekly period straddling the boundary.
      await seedSourcePeriod(`${budgetId}_2027M03`, '2027-03-01', '2027-03-31');
      await seedSourcePeriod(`${budgetId}_2027M04`, '2027-04-01', '2027-04-30');
      await seedSourcePeriod(
        `${budgetId}_2027W13`,
        '2027-03-29',
        '2027-04-04',
        'weekly'
      );

      await process_budget_created_orchestrator(ctx(), {
        budget_id: budgetId,
        user_id: userId,
        group_ids: [],
        budget_name: 'Groceries',
        amount: 300,
        cadence: 'monthly',
        start_ms: new Date('2027-03-01').getTime(),
        generation_end_ms: new Date('2027-05-01').getTime(),
        is_recurring: true,
        claims: [],
        everything_else_budget_id: null,
      });

      const periods = await periodsFor(budgetId);
      const monthlies = periods.filter((p) => p.periodType === 'monthly');
      expect(monthlies).toHaveLength(2);
      monthlies.forEach((m) => {
        expect(m.isPrime).toBe(true);
        expect(m.primePeriodBreakdown).toEqual([]);
      });
      const monthlyIds = (monthlies.map((m) => m.id) as string[]).sort();

      const weekly = periods.find((p) => p.periodType === 'weekly')!;
      expect(weekly.isPrime).toBe(false);
      // The non-prime period references exactly the two overlapping prime periods.
      expect([...(weekly.primePeriodIds as string[])].sort()).toEqual(monthlyIds);
      expect(weekly.primePeriodBreakdown).toHaveLength(2);
      const days = (weekly.primePeriodBreakdown as Array<{ daysContributed: number }>)
        .reduce((s, b) => s + b.daysContributed, 0);
      expect(days).toBe(7);
      // 3 days @ 300/31 (March) + 4 days @ 10 (April)
      expect(weekly.allocatedAmount).toBeCloseTo(3 * (300 / 31) + 4 * 10, 2);
    });
  });

  describe('process_budget_updated — amount (in-place reallocation)', () => {
    it('reallocates current+future, preserves notes/checklist, skips historical', async () => {
      const userId = uid();
      const budgetId = bid();
      await seedBudget(budgetId, userId, { amount: 100 });

      // Historical period (ended in the past) — must be untouched.
      await seedPeriod(
        `${budgetId}_hist`,
        budgetId,
        userId,
        iso(daysFromNow(-60)),
        iso(daysFromNow(-31)),
        { allocatedAmount: 100, userNotes: 'history note' }
      );
      // Current period with user data — re-allocated, data preserved.
      await seedPeriod(
        `${budgetId}_cur`,
        budgetId,
        userId,
        iso(daysFromNow(-5)),
        iso(daysFromNow(25)),
        {
          allocatedAmount: 100,
          spent: 20,
          userNotes: 'my note',
          checklistItems: [{ id: 'c1', name: 'milk', isChecked: true }],
          modifiedAmount: 150,
        }
      );
      // Current weekly (non-prime) fully inside the monthly period — its
      // breakdown must be refreshed from the new monthly rate.
      await seedPeriod(
        `${budgetId}_wk`,
        budgetId,
        userId,
        iso(daysFromNow(0)),
        iso(daysFromNow(6)),
        { periodType: 'weekly', allocatedAmount: 23, isPrime: false }
      );

      await process_budget_updated_orchestrator(ctx(), {
        budget_id: budgetId,
        user_id: userId,
        group_ids: [],
        budget_name: 'Test Budget',
        amount: 400,
        cadence: 'monthly',
        start_ms: daysFromNow(-5).getTime(),
        generation_end_ms: daysFromNow(360).getTime(),
        is_recurring: true,
        added_claims: [],
        released_category_ids: [],
        everything_else_budget_id: null,
        regenerate_periods: true,
        name_changed: false,
      });

      const cur = (await db.collection('budget_periods').doc(`${budgetId}_cur`).get()).data();
      const hist = (await db.collection('budget_periods').doc(`${budgetId}_hist`).get()).data();

      // current re-allocated (monthly→monthly = 1:1 = new amount)
      expect(cur?.allocatedAmount).toBe(400);
      expect(cur?.remaining).toBe(380); // 400 - 20 spent
      // user data preserved
      expect(cur?.userNotes).toBe('my note');
      expect(cur?.checklistItems).toEqual([{ id: 'c1', name: 'milk', isChecked: true }]);
      expect(cur?.modifiedAmount).toBe(150);
      // historical untouched
      expect(hist?.allocatedAmount).toBe(100);
      expect(hist?.userNotes).toBe('history note');
      // not deleted + recreated
      expect((await periodsFor(budgetId)).length).toBe(3);

      // weekly non-prime breakdown refreshed from the new monthly rate
      const wk = (await db.collection('budget_periods').doc(`${budgetId}_wk`).get()).data();
      expect(wk?.isPrime).toBe(false);
      expect(wk?.primePeriodIds).toEqual([`${budgetId}_cur`]);
      expect(wk?.primePeriodBreakdown).toHaveLength(1);
      // 7 days inside the 31-day monthly period at the new $400/period rate.
      expect(wk?.allocatedAmount).toBeCloseTo((7 * 400) / 31, 2);
    });
  });

  describe('process_budget_updated — rename', () => {
    it('propagates budgetName to current+future, leaves historical', async () => {
      const userId = uid();
      const budgetId = bid();
      await seedBudget(budgetId, userId, { name: 'New Name' });
      await seedPeriod(`${budgetId}_h`, budgetId, userId, iso(daysFromNow(-60)), iso(daysFromNow(-31)), {
        budgetName: 'Old Name',
      });
      await seedPeriod(`${budgetId}_c`, budgetId, userId, iso(daysFromNow(-5)), iso(daysFromNow(25)), {
        budgetName: 'Old Name',
      });

      await process_budget_updated_orchestrator(ctx(), {
        budget_id: budgetId,
        user_id: userId,
        group_ids: [],
        budget_name: 'New Name',
        amount: 100,
        cadence: 'monthly',
        start_ms: daysFromNow(-5).getTime(),
        generation_end_ms: daysFromNow(360).getTime(),
        is_recurring: true,
        added_claims: [],
        released_category_ids: [],
        everything_else_budget_id: null,
        regenerate_periods: false,
        name_changed: true,
      });

      const c = (await db.collection('budget_periods').doc(`${budgetId}_c`).get()).data();
      const h = (await db.collection('budget_periods').doc(`${budgetId}_h`).get()).data();
      expect(c?.budgetName).toBe('New Name');
      expect(h?.budgetName).toBe('Old Name'); // historical unchanged
    });
  });

  describe('process_budget_deleted', () => {
    it('deletes periods, reassigns splits to Everything Else, releases categories', async () => {
      const userId = uid();
      const budgetId = bid();
      const eeId = bid();

      await seedBudget(eeId, userId, {
        name: 'Everything Else',
        isSystemEverythingElse: true,
        categoryIds: ['existing_cat'],
      });
      await seedPeriod(`${budgetId}_p1`, budgetId, userId, iso(daysFromNow(-5)), iso(daysFromNow(25)));

      const txnId = `txn_${Date.now()}`;
      /* eslint-disable @typescript-eslint/naming-convention */
      await db.collection('transactions').doc(txnId).set({
        id: txnId,
        ownerId: userId,
        userId,
        isActive: true,
        splits: [{ splitId: 's1', budgetId, budgetName: 'Test Budget', amount: 42 }],
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      await process_budget_deleted_orchestrator(ctx(), {
        budget_id: budgetId,
        user_id: userId,
        group_ids: [],
        budget_period_ids: [`${budgetId}_p1`],
        affected_transaction_ids: [txnId],
        release_category_ids: ['released_cat'],
        everything_else_budget_id: eeId,
      });

      // periods deleted
      expect((await periodsFor(budgetId)).length).toBe(0);
      // split reassigned to EE
      const txn = (await db.collection('transactions').doc(txnId).get()).data();
      expect(txn?.splits[0].budgetId).toBe(eeId);
      expect(txn?.splits[0].budgetName).toBe('Everything Else');
      // category released to EE
      const ee = (await db.collection('budgets').doc(eeId).get()).data();
      expect(ee?.categoryIds).toEqual(expect.arrayContaining(['existing_cat', 'released_cat']));
    });
  });
});
