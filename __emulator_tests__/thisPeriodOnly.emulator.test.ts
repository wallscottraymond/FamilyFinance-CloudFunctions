/**
 * Emulator Integration Test — "This Period Only" shows on the period page (Transaction-Integrity
 * proof, app action U9 / decision 4c-9).
 *
 * `updateBudgetPeriodAmount` (This Period Only) stores the user's amount as `modifiedAmount` on
 * the monthly period (`isModified: true`); the period page must show THAT amount for the period,
 * and the budget's own amount again once the user resets it.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern thisPeriodOnly"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
const db = admin.firestore();

import { derive_period_orchestrator } from '../src/functions/orchestrators/periods/derive_period.orchestrator';
import { updateBudgetPeriodAmount } from '../src/functions/budgets/api/periods/updateBudgetPeriodAmount';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edit_amount = (data: unknown): Promise<any> => (updateBudgetPeriodAmount as any).run({
  data, auth: { uid: U, token: { uid: U } }, rawRequest: {},
});

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `tp_u_${RUN}`;
const B = `tp_b_${RUN}`;
const P = `${B}_2031M07`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const JUL = { start: Date.parse('2031-07-01T00:00:00Z'), end: Date.parse('2031-07-31T23:59:59.999Z') };

const page_allocated = async () => {
  const r = await derive_period_orchestrator(t(), U, {
    view_cadence: 'monthly', window_start_ms: JUL.start, window_end_ms: JUL.end, force: true,
  });
  const b = r.budgets.find((x) => x.budget_id === B);
  return (b?.periods ?? []).reduce((s, p) => s + p.allocated_amount, 0);
};

/* eslint-disable @typescript-eslint/naming-convention */
describe('"This Period Only" amount on the period page (emulator)', () => {
  beforeAll(async () => {
    await db.collection('source_periods').doc('2031M07').set({
      periodId: '2031M07', type: 'monthly', startDate: ts('2031-07-01T00:00:00Z'),
      endDate: ts('2031-07-31T23:59:59.999Z'), year: 2031,
    });
    await db.collection('users').doc(U).set({ email: 'x@x.com', isActive: true, role: 'editor' });
    await db.collection('budgets').doc(B).set({
      id: B, userId: U, createdBy: U, groupIds: [], isActive: true,
      access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
      name: 'Dining', amount: 400, currency: 'USD', categoryIds: ['eating_out'], period: 'monthly',
      budgetType: 'recurring', startDate: ts('2031-01-01T00:00:00Z'), endDate: ts('2032-01-01T00:00:00Z'),
      isOngoing: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await db.collection('budget_periods').doc(P).set({
      id: P, budgetId: B, userId: U, groupIds: [], periodId: '2031M07', sourcePeriodId: '2031M07', periodType: 'monthly',
      periodStart: ts('2031-07-01T00:00:00Z'), periodEnd: ts('2031-07-31T23:59:59.999Z'),
      allocatedAmount: 400, rolledOverAmount: 0, spent: 0, remaining: 400, isActive: true,
    });
  });
  afterAll(async () => { await db.terminate(); });

  it('without an override the page shows the budget amount', async () => {
    expect(await page_allocated()).toBe(400);
  });
  it('This Period Only = 250 → the page shows 250 for that period', async () => {
    await db.collection('budget_periods').doc(P).update({ modifiedAmount: 250, isModified: true });
    expect(await page_allocated()).toBe(250);
  });
  it('Reset to Original (isModified false) → back to the budget amount', async () => {
    await db.collection('budget_periods').doc(P).update({ isModified: false });
    expect(await page_allocated()).toBe(400);
  });
  it('a WEEK\'s amount synced onto the month (non-prime copy) never becomes the month\'s allocation', async () => {
    // syncModifiedAmountToOverlappingPeriods pastes a week's "This Period Only" amount, unprorated,
    // onto overlapping periods of other types — the page must ignore that copy.
    await db.collection('budget_periods').doc(P).update({
      modifiedAmount: 150, isModified: true, modifiedAmountSyncedFrom: `${B}_2031W30`,
    });
    expect(await page_allocated()).toBe(400);
    await db.collection('budget_periods').doc(P).update({ isPrime: false, modifiedAmountSyncedFrom: admin.firestore.FieldValue.delete() });
    expect(await page_allocated()).toBe(400);
  });
  it('This Period Only from a WEEK of a monthly budget adds the same $ change to the month (never the week\'s figure)', async () => {
    await db.collection('budget_periods').doc(P).set({
      modifiedAmount: admin.firestore.FieldValue.delete(), isModified: false, isPrime: true,
      modifiedAmountSyncedFrom: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    const W = `${B}_2031W28`;
    await db.collection('budget_periods').doc(W).set({
      id: W, budgetId: B, userId: U, groupIds: [], periodId: '2031W28', sourcePeriodId: '2031W28', periodType: 'weekly',
      periodStart: ts('2031-07-06T00:00:00Z'), periodEnd: ts('2031-07-12T23:59:59.999Z'),
      allocatedAmount: 90.32, spent: 0, isActive: true, isPrime: false, primePeriodIds: [P],
    });
    await edit_amount({ budgetPeriodId: W, newAmount: 140.32, cascadeScope: 'this_period' });
    const month = (await db.collection('budget_periods').doc(P).get()).data()!;
    expect(month.modifiedAmount).toBe(450); // 400 + (140.32 − 90.32), not 140.32
    expect(await page_allocated()).toBe(450);
  });
  it('All Periods Forward from a WEEK of a monthly budget scales the budget by the same RATIO', async () => {
    const W = `${B}_2031W28`;
    await db.collection('budgets').doc(B).update({ amount: 400 });
    await db.collection('budget_periods').doc(P).update({
      isModified: false, modifiedAmount: admin.firestore.FieldValue.delete(), allocatedAmount: 400,
    });
    await db.collection('budget_periods').doc(W).update({ allocatedAmount: 90.32 });
    // Week 90.32 → 135.48 (×1.5): the monthly budget becomes 400 × 1.5 = 600, not 400 + 45.16.
    await edit_amount({ budgetPeriodId: W, newAmount: 135.48, cascadeScope: 'all_forward' });
    const budget = (await db.collection('budgets').doc(B).get()).data()!;
    expect(budget.amount).toBeCloseTo(600, 0);
  });
  it('All Periods Forward on a month that has a This Period Only override sets the NORMAL amount', async () => {
    await db.collection('budgets').doc(B).update({ amount: 400 });
    await db.collection('budget_periods').doc(P).update({
      allocatedAmount: 400, modifiedAmount: 300, isModified: true, isPrime: true,
      modifiedAmountSyncedFrom: admin.firestore.FieldValue.delete(),
    });
    await edit_amount({ budgetPeriodId: P, newAmount: 500, cascadeScope: 'all_forward' });
    const budget = (await db.collection('budgets').doc(B).get()).data()!;
    expect(budget.amount).toBeCloseTo(500, 2); // not 400 × 500/300 = 666.67
  });
  it('All Periods Forward from a WEEK whose month has an override: the week ends at what was typed', async () => {
    const W = `${B}_2031W28`;
    await db.collection('budgets').doc(B).update({ amount: 400 });
    // Month $400 with a $300 "This Period Only": the week is spread from the $300 (300 × 7/31).
    await db.collection('budget_periods').doc(P).update({
      allocatedAmount: 400, modifiedAmount: 300, isModified: true, isPrime: true,
      modifiedAmountSyncedFrom: admin.firestore.FieldValue.delete(),
    });
    await db.collection('budget_periods').doc(W).update({ allocatedAmount: 67.74 });
    await edit_amount({ budgetPeriodId: W, newAmount: 100, cascadeScope: 'all_forward' });
    const budget = (await db.collection('budgets').doc(B).get()).data()!;
    // 300 × (100 / 67.74) = 442.87 → the week shows ≈ $100, not 400 × 1.476 = $590.
    expect(budget.amount).toBeCloseTo(442.87, 0);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
