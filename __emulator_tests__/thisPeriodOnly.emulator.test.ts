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
    await db.collection('users').doc(U).set({ email: 'x@x.com' });
    await db.collection('budgets').doc(B).set({
      id: B, userId: U, createdBy: U, groupIds: [], isActive: true,
      access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
      name: 'Dining', amount: 400, currency: 'USD', categoryIds: ['eating_out'], period: 'monthly',
      budgetType: 'recurring', startDate: ts('2031-01-01T00:00:00Z'), endDate: ts('2032-01-01T00:00:00Z'),
      isOngoing: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await db.collection('budget_periods').doc(P).set({
      id: P, budgetId: B, userId: U, groupIds: [], periodId: '2031M07', periodType: 'monthly',
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
});
/* eslint-enable @typescript-eslint/naming-convention */
