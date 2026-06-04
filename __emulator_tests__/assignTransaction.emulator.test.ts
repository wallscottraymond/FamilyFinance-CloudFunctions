/**
 * Emulator Integration Test — Transaction Assignment Engine (orchestrator shell)
 *
 * Drives assign_transaction_orchestrator against the Firestore emulator:
 * resolver → pure core → single write → fan-out. Asserts per-split assignment
 * (incl. the per-split Everything Else structural fallback), the denormalized
 * splitBudgetIds, and the recompute_budget_spent fan-out job.
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

import { assign_transaction_orchestrator } from '../src/functions/orchestrators/transactions/assign_transaction.orchestrator';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(id: string, userId: string, fields: Record<string, unknown>) {
  await db.collection('budgets').doc(id).set({
    id, userId, createdBy: userId, groupIds: [], isActive: true,
    access: { ownerId: userId, createdBy: userId, groupIds: [], isPrivate: true },
    name: id, amount: 0, currency: 'USD', categoryIds: [], period: 'monthly',
    startDate: ts('2026-01-01'), endDate: ts('2027-01-01'), isOngoing: true,
    isSystemEverythingElse: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    ...fields,
  });
}

async function seedSourcePeriod(id: string, type: string, startISO: string, endISO: string) {
  await db.collection('source_periods').doc(id).set({
    periodId: id, type, startDate: ts(startISO), endDate: ts(endISO), year: 2026,
  });
}

async function seedTransaction(id: string, userId: string, splits: Array<Record<string, unknown>>) {
  await db.collection('transactions').doc(id).set({
    transactionId: id, userId, isActive: true, transactionDate: ts('2026-06-15'),
    merchantName: 'Test Merchant', name: 'Test txn', splits,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
function split(splitId: string, plaidCat: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    splitId, budgetId: 'unassigned', plaidPrimaryCategory: plaidCat, plaidDetailedCategory: plaidCat,
    internalPrimaryCategory: null, internalDetailedCategory: null, amount,
    monthlyPeriodId: null, weeklyPeriodId: null, biWeeklyPeriodId: null,
    isDefault: false, paymentDate: ts('2026-06-15'), rules: [], tags: [],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...over,
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

async function jobsFor(jobType: string, transactionId: string) {
  const snap = await db.collection('_jobs').where('job_type', '==', jobType).get();
  return snap.docs.map((d) => d.data()).filter(
    (j) => (j.payload as { transaction_id?: string })?.transaction_id === transactionId
  );
}

describe('assign_transaction_orchestrator (emulator)', () => {
  afterAll(async () => { await db.terminate(); });

  it('assigns per-split (category → budget, else Everything Else) + writes splitBudgetIds + fans out', async () => {
    const userId = uid();
    const txnId = `txn_${Date.now()}`;
    await seedBudget(`groceries_${txnId}`, userId, { categoryIds: ['FOOD_AND_DRINK'], isSystemEverythingElse: false });
    await seedBudget(`ee_${txnId}`, userId, { categoryIds: ['ALL'], isSystemEverythingElse: true });
    await seedSourcePeriod(`${txnId}_2026M06`, 'monthly', '2026-06-01', '2026-06-30');
    await seedSourcePeriod(`${txnId}_2026W24`, 'weekly', '2026-06-14', '2026-06-20');
    // Split 1 → Groceries (FOOD_AND_DRINK); Split 2 → Everything Else (TRAVEL, unowned)
    await seedTransaction(txnId, userId, [
      split('s1', 'FOOD_AND_DRINK', 60),
      split('s2', 'TRAVEL', 40),
    ]);

    const res = await assign_transaction_orchestrator(ctx(), { user_id: userId, transaction_id: txnId });
    expect(res.found).toBe(true);
    expect(res.changed).toBe(true);

    const doc = (await db.collection('transactions').doc(txnId).get()).data()!;
    const s1 = doc.splits.find((s: { splitId: string }) => s.splitId === 's1');
    const s2 = doc.splits.find((s: { splitId: string }) => s.splitId === 's2');
    // per-split: only the matching split goes to Groceries; the other → EE
    expect(s1.budgetId).toBe(`groceries_${txnId}`);
    expect(s2.budgetId).toBe(`ee_${txnId}`);
    // source periods stamped on every split
    expect(s1.monthlyPeriodId).toBe(`${txnId}_2026M06`);
    expect(s1.weeklyPeriodId).toBe(`${txnId}_2026W24`);
    // denormalized splitBudgetIds (queryable)
    expect([...doc.splitBudgetIds].sort()).toEqual([`ee_${txnId}`, `groceries_${txnId}`].sort());

    // fan-out enqueued for the touched budgets
    const jobs = await jobsFor('recompute_budget_spent', txnId);
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as { budget_ids: string[] }).budget_ids).toEqual(
      expect.arrayContaining([`groceries_${txnId}`, `ee_${txnId}`])
    );
  });

  it('is idempotent — a second run makes no change (skip-if-unchanged)', async () => {
    const userId = uid();
    const txnId = `txn2_${Date.now()}`;
    await seedBudget(`g_${txnId}`, userId, { categoryIds: ['FOOD_AND_DRINK'], isSystemEverythingElse: false });
    await seedBudget(`ee_${txnId}`, userId, { isSystemEverythingElse: true });
    await seedSourcePeriod(`${txnId}_m`, 'monthly', '2026-06-01', '2026-06-30');
    await seedTransaction(txnId, userId, [split('s1', 'FOOD_AND_DRINK', 100)]);

    const first = await assign_transaction_orchestrator(ctx(), { user_id: userId, transaction_id: txnId });
    expect(first.changed).toBe(true);
    const second = await assign_transaction_orchestrator(ctx(), { user_id: userId, transaction_id: txnId });
    expect(second.changed).toBe(false); // already settled → no write, no new fan-out
  });

  it('returns found:false for a missing transaction', async () => {
    const res = await assign_transaction_orchestrator(ctx(), { user_id: uid(), transaction_id: 'nope' });
    expect(res.found).toBe(false);
  });
});
