/**
 * Emulator Integration Test — split edits apply immediately (canon O2 / M3, Transaction-Integrity-Review 3g, 3-0)
 *
 * Drives the `updateTransactionSplits` callable: re-categorizing a split (the app's explicit pick,
 * and an old build's bare `categoryId`) re-homes it to the right budget IN THE SAME WRITE —
 * stamped `assignRunId` (the trigger skips it), `categorySource:'user'`, Plaid codes untouched,
 * no legacy `internal*` written — and "use auto" returns it to Plaid's category.
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

import { updateTransactionSplits } from '../src/functions/transactions/api/crud/updateTransactionSplits';
import { invalidate_category_cache } from '../src/functions/repositories/category.repo';

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `se_u_${RUN}`;
const TXN = `se_t_${RUN}`;
const GRO = `se_gro_${RUN}`;
const EAT = `se_eat_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: unknown): Promise<any> => (updateTransactionSplits as any).run({
  data, auth: { uid: U, token: {} }, rawRequest: {},
});

/* eslint-disable @typescript-eslint/naming-convention */
async function budget(id: string, categoryIds: string[], ee = false, period = 'monthly') {
  await db.collection('budgets').doc(id).set({
    id, userId: U, createdBy: U, groupIds: [], isActive: true,
    access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
    name: id, amount: 100, currency: 'USD', categoryIds, period, budgetType: 'recurring',
    startDate: ts('2026-01-01T00:00:00Z'), endDate: ts('2027-01-01T00:00:00Z'),
    isOngoing: true, isSystemEverythingElse: ee, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const split = async () => (await db.collection('transactions').doc(TXN).get()).data()!;

describe('updateTransactionSplits applies the edit immediately (emulator)', () => {
  beforeAll(async () => {
    await db.collection('categories').doc(`SE_GRO_${RUN}`).set({ isActive: true, firstCategoryId: `se_groceries_${RUN}`, overallCategoryId: 'food', first_category: 'Groceries' });
    await db.collection('categories').doc(`SE_EAT_${RUN}`).set({ isActive: true, firstCategoryId: `se_eating_${RUN}`, overallCategoryId: 'food', first_category: 'Eating out' });
    invalidate_category_cache();
    await db.collection('users').doc(U).set({ email: 'x@x.com' });
    await budget(GRO, [`se_groceries_${RUN}`]);
    await budget(EAT, [`se_eating_${RUN}`]);
    await budget(`se_ee_m_${RUN}`, [], true, 'monthly');
    await budget(`se_ee_w_${RUN}`, [], true, 'weekly');
    await budget(`se_ee_b_${RUN}`, [], true, 'bi_monthly');
    await db.collection('transactions').doc(TXN).set({
      transactionId: TXN, userId: U, ownerId: U, isActive: true, transactionDate: ts('2026-06-15T12:00:00Z'),
      amount: 40, merchantName: 'Store', name: 'Store', type: 'expense', accountId: 'acc',
      splits: [{
        splitId: 's1', id: 's1', amount: 40, isDefault: true, budgetId: GRO, monthlyBudgetId: GRO,
        plaidPrimaryCategory: 'FOOD_AND_DRINK', plaidDetailedCategory: `SE_GRO_${RUN}`,
        categorySource: 'plaid', firstCategoryId: `se_groceries_${RUN}`, categoryId: `se_groceries_${RUN}`,
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  });
  afterAll(async () => { await db.terminate(); });

  it("the app's pick re-homes the split in the same write (stamped, user source, codes kept)", async () => {
    const s0 = (await split()).splits[0];
    await call({ transactionId: TXN, splits: [{ ...s0, categorySource: 'user', firstCategoryId: `se_eating_${RUN}` }] });
    const doc = await split();
    expect(doc.assignRunId).toBeTruthy(); // engine ran in memory; the trigger skips this write
    expect(doc.splits[0]).toMatchObject({
      categorySource: 'user', firstCategoryId: `se_eating_${RUN}`, monthlyBudgetId: EAT,
      plaidDetailedCategory: `SE_GRO_${RUN}`, internalDetailedCategory: null,
    });
  });

  it('"use auto" returns it to Plaid\'s category and budget', async () => {
    const s0 = (await split()).splits[0];
    await call({ transactionId: TXN, splits: [{ ...s0, categorySource: 'plaid' }] });
    expect((await split()).splits[0]).toMatchObject({
      categorySource: 'plaid', firstCategoryId: `se_groceries_${RUN}`, monthlyBudgetId: GRO,
    });
  });

  it("an old build's changed bare categoryId is translated to the same pick", async () => {
    const s0 = (await split()).splits[0];
    await call({ transactionId: TXN, splits: [{ ...s0, categoryId: `SE_EAT_${RUN}` }] });
    expect((await split()).splits[0]).toMatchObject({
      categorySource: 'user', firstCategoryId: `se_eating_${RUN}`, monthlyBudgetId: EAT,
    });
  });
});
