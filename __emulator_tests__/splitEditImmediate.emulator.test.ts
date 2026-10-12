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
import { transaction_repo } from '../src/functions/repositories/transaction.repo';

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

  it('a status tap from an OLD build that omits fields keeps them; spend-only, stamped', async () => {
    const s0 = (await split()).splits[0];
    // An old build re-sends the split without the category / per-lens fields.
    await call({ transactionId: TXN, splits: [{ splitId: 's1', id: 's1', amount: 40, isDefault: true, spendStatus: 'ignored' }] });
    const doc = await split();
    expect(doc.assignRunId).toBeTruthy(); // the trigger skips it; spend recompute is queued
    expect(doc.splits[0]).toMatchObject({
      spendStatus: 'ignored', firstCategoryId: s0.firstCategoryId, categorySource: s0.categorySource,
      monthlyBudgetId: s0.monthlyBudgetId, plaidDetailedCategory: `SE_GRO_${RUN}`,
    });
    expect(doc.hasIgnoredSplits).toBe(true);
  });

  it('a write that lands between our read and write is never overwritten: re-read + rebuild', async () => {
    const s0 = (await split()).splits[0];
    const real = transaction_repo.update_raw_if_unchanged.bind(transaction_repo);
    let calls = 0;
    const spy = jest.spyOn(transaction_repo, 'update_raw_if_unchanged').mockImplementation(
      async (c, id, fields, t) => {
        if (++calls === 1) {
          // A sync lands in between (e.g. the merchant name changes).
          await db.collection('transactions').doc(TXN).update({ merchantName: 'Store #2' });
        }
        return real(c, id, fields, t);
      }
    );
    try {
      await call({ transactionId: TXN, splits: [{ ...s0, spendStatus: 'counted', userNotes: 'x' }], userNotes: 'note' });
    } finally {
      spy.mockRestore();
    }
    const doc = await split();
    expect(calls).toBe(2); // lost the race once, then wrote on the newer doc
    expect(doc.merchantName).toBe('Store #2'); // the sync's write survived
    expect(doc.userNotes).toBe('note'); // and so did the edit
  });

  it('re-categorizing a transfer OUT of transfers clears its stored role in the same write', async () => {
    const id = `se_xfer_${RUN}`;
    await db.collection('categories').doc(`TRANSFER_OUT_SE_${RUN}`).set({ isActive: true, firstCategoryId: `se_transfer_${RUN}`, overallCategoryId: 'transfer', first_category: 'Transfer' });
    invalidate_category_cache();
    await db.collection('transactions').doc(id).set({
      transactionId: id, userId: U, ownerId: U, isActive: true, transactionDate: ts('2026-01-10T12:00:00Z'),
      amount: 50, merchantName: 'Zelle', name: 'Zelle', type: 'transfer', accountId: 'acc', transferRole: 'internal',
      splits: [{
        splitId: 's1', id: 's1', amount: 50, isDefault: true, budgetId: 'unassigned',
        plaidPrimaryCategory: 'TRANSFER_OUT', plaidDetailedCategory: `TRANSFER_OUT_SE_${RUN}`,
        categorySource: 'plaid', firstCategoryId: `se_transfer_${RUN}`,
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    const s0 = (await db.collection('transactions').doc(id).get()).data()!.splits[0];
    await call({ transactionId: id, splits: [{ ...s0, categorySource: 'user', firstCategoryId: `se_eating_${RUN}` }] });
    const doc = (await db.collection('transactions').doc(id).get()).data()!;
    expect(doc.transferRole).toBe('none');
    expect(doc.splits[0].monthlyBudgetId).toBe(EAT); // and it's spending now
  });

  it('splits that add up to MORE than the transaction are refused (never over-counted)', async () => {
    const s0 = (await split()).splits[0];
    await expect(call({ transactionId: TXN, splits: [{ ...s0, amount: 40 }, { amount: 20 }] }))
      .rejects.toThrow(/more than the transaction/);
    expect((await split()).splits).toHaveLength(1); // nothing written
  });
});

