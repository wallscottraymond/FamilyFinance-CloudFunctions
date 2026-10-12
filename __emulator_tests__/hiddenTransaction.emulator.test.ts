/**
 * Emulator Integration Test — a HIDDEN transaction counts nowhere (Transaction-Integrity proof,
 * app action T7 / decision 4c-7).
 *
 * "Hide" goes through the `updateTransactionSplits` callable (`isHidden`). A hidden transaction
 * reads as Ignored everywhere money is counted — the period page and the stored budget spend —
 * without touching the stored statuses, so "Unhide" brings the user's own choices back.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern hiddenTransaction"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
const db = admin.firestore();

import { updateTransactionSplits } from '../src/functions/transactions/api/crud/updateTransactionSplits';
import { invalidate_category_cache } from '../src/functions/repositories/category.repo';
import { derive_period_orchestrator } from '../src/functions/orchestrators/periods/derive_period.orchestrator';
import { resolve_spend_splits } from '../src/functions/resolvers/budgets/budget_spend.resolver';
import { compute_budget_spent } from '../src/functions/domain/budgets/budget_spend.service';

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `hd_u_${RUN}`;
const GRO = `hd_gro_${RUN}`;
const HIDE = `hd_t1_${RUN}`;
const KEEP = `hd_t2_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
const JUN = { start: Date.parse('2031-06-01T00:00:00Z'), end: Date.parse('2031-06-30T23:59:59.999Z') };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: unknown): Promise<any> => (updateTransactionSplits as any).run({
  data, auth: { uid: U, token: {} }, rawRequest: {},
});

/* eslint-disable @typescript-eslint/naming-convention */
async function budget(id: string, categoryIds: string[], ee = false) {
  await db.collection('budgets').doc(id).set({
    id, userId: U, createdBy: U, groupIds: [], isActive: true,
    access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
    name: id, amount: 500, currency: 'USD', categoryIds, period: 'monthly', budgetType: 'recurring',
    startDate: ts('2031-01-01T00:00:00Z'), endDate: ts('2032-01-01T00:00:00Z'),
    isOngoing: true, isSystemEverythingElse: ee, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
async function txn(id: string, amount: number, iso: string, split_over: Record<string, unknown> = {}) {
  await db.collection('transactions').doc(id).set({
    transactionId: id, userId: U, ownerId: U, isActive: true, isPending: false,
    transactionDate: ts(iso), amount, merchantName: 'Store', name: 'Store', type: 'expense', accountId: 'acc',
    splits: [{
      splitId: 's1', id: 's1', amount, isDefault: true, budgetId: GRO, monthlyBudgetId: GRO,
      plaidPrimaryCategory: 'FOOD_AND_DRINK', plaidDetailedCategory: `HD_GRO_${RUN}`,
      categorySource: 'plaid', firstCategoryId: `hd_groceries_${RUN}`, ...split_over,
    }],
    splitBudgetIds: [GRO], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const page_spent = async () => {
  const r = await derive_period_orchestrator(t(), U, {
    view_cadence: 'monthly', window_start_ms: JUN.start, window_end_ms: JUN.end, force: true,
  });
  const b = r.budgets.find((x) => x.budget_id === GRO);
  return Math.round((b?.periods ?? []).reduce((s, p) => s + p.spent, 0) * 100) / 100;
};
const stored_spent = async () =>
  compute_budget_spent(GRO, JUN.start, JUN.end, await resolve_spend_splits(t(), U, GRO, JUN.start, JUN.end, 'monthly')).spent;
const doc = async (id: string) => (await db.collection('transactions').doc(id).get()).data()!;

describe('a hidden transaction counts nowhere (emulator)', () => {
  beforeAll(async () => {
    await db.collection('source_periods').doc('2031M06').set({
      periodId: '2031M06', type: 'monthly', startDate: ts('2031-06-01T00:00:00Z'),
      endDate: ts('2031-06-30T23:59:59.999Z'), year: 2031,
    });
    await db.collection('categories').doc(`HD_GRO_${RUN}`).set({
      isActive: true, firstCategoryId: `hd_groceries_${RUN}`, overallCategoryId: 'food', first_category: 'Groceries',
    });
    invalidate_category_cache();
    await db.collection('users').doc(U).set({ email: 'x@x.com' });
    await budget(GRO, [`hd_groceries_${RUN}`]);
    await budget(`hd_ee_${RUN}`, [], true);
    // The hidden one carries a user's REFUND choice that Unhide must bring back.
    await txn(HIDE, 40, '2031-06-10T12:00:00Z', { spendStatus: 'refund' });
    await txn(KEEP, 60, '2031-06-12T12:00:00Z');
  });
  afterAll(async () => { await db.terminate(); });

  it('before: both purchases count (the refund nets against the budget)', async () => {
    const before = await page_spent();
    expect(before).toBe(await stored_spent());
    expect(before).not.toBe(60); // the hidden-to-be purchase moves the number
  });

  it('Hide: the purchase leaves the budget on the page AND in the stored spend; statuses untouched', async () => {
    const s = (await doc(HIDE)).splits;
    await call({ transactionId: HIDE, splits: s, isHidden: true });
    expect((await doc(HIDE)).isHidden).toBe(true);
    expect(await page_spent()).toBe(60);
    expect(await stored_spent()).toBe(60);
    expect((await doc(HIDE)).splits[0].spendStatus).toBe('refund'); // the user's choice is kept
  });

  it('Unhide: it counts again, with the user\'s own status', async () => {
    expect(await stored_spent()).toBe(60); // still hidden
    const s = (await doc(HIDE)).splits;
    await call({ transactionId: HIDE, splits: s, isHidden: false });
    const page = await page_spent();
    expect(page).toBe(await stored_spent());
    expect(page).not.toBe(60);
  });
});
