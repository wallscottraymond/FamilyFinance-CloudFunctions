/**
 * Emulator Integration Test — recompute_budget_spent (spend pipeline)
 *
 * Seeds a budget period + transactions with assigned splits, runs the recompute
 * orchestrator, and asserts budget_period.spent/pendingSpent/remaining — the
 * invalidation-based recompute that makes budgets show real spent (not $0).
 * Verifies the countable predicate (transfer + recurring excluded) and refunds
 * netting in.
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

import { recompute_budget_spent_orchestrator } from '../src/functions/orchestrators/budgets/recompute_budget_spent.orchestrator';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const JUN_15 = new Date('2026-06-15').getTime();
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

/* eslint-disable @typescript-eslint/naming-convention */
async function seedPeriod(id: string, budgetId: string, allocated: number) {
  await db.collection('budget_periods').doc(id).set({
    id, budgetId, periodId: id, periodType: 'monthly',
    periodStart: ts('2026-06-01'), periodEnd: ts('2026-06-30T23:59:59'),
    allocatedAmount: allocated, rolledOverAmount: 0, spent: 0, remaining: allocated,
    isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
async function seedTxn(
  id: string, userId: string, budgetId: string, amount: number,
  over: { isPending?: boolean; type?: string; isIgnored?: boolean; outflowId?: string | null; inflowId?: string | null } = {}
) {
  await db.collection('transactions').doc(id).set({
    transactionId: id, userId, isActive: true, transactionDate: ts('2026-06-15'),
    type: over.type ?? 'expense', isPending: over.isPending ?? false,
    splits: [{
      splitId: `${id}_s1`, budgetId, amount,
      isIgnored: over.isIgnored ?? false,
      outflowId: over.outflowId ?? null, inflowId: over.inflowId ?? null,
    }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

describe('recompute_budget_spent (emulator)', () => {
  afterAll(async () => { await db.terminate(); });

  it('recomputes spent from assigned splits — countable only, refunds net, pending tracked', async () => {
    const userId = uid();
    const budgetId = `b_${Date.now()}`;
    const periodId = `${budgetId}_2026M06`;
    await seedPeriod(periodId, budgetId, 300);

    await seedTxn(`t1_${budgetId}`, userId, budgetId, 60);                       // posted   → +60
    await seedTxn(`t2_${budgetId}`, userId, budgetId, 40, { isPending: true });  // pending  → +40 (also pendingSpent)
    await seedTxn(`t3_${budgetId}`, userId, budgetId, 200, { type: 'transfer' }); // transfer → excluded
    await seedTxn(`t4_${budgetId}`, userId, budgetId, -30);                      // refund   → -30
    await seedTxn(`t5_${budgetId}`, userId, budgetId, 300, { outflowId: 'o1' }); // bill     → excluded

    const res = await recompute_budget_spent_orchestrator(ctx(), {
      user_id: userId,
      budget_ids: [budgetId],
      transaction_date_ms: JUN_15,
    });
    expect(res.periods_updated).toBe(1);

    const period = (await db.collection('budget_periods').doc(periodId).get()).data()!;
    expect(period.spent).toBe(70);          // 60 + 40 - 30 (transfer + bill excluded)
    expect(period.pendingSpent).toBe(40);
    expect(period.remaining).toBe(230);     // 300 - 70
  });

  it('recompute is idempotent (re-run yields the same spent)', async () => {
    const userId = uid();
    const budgetId = `b2_${Date.now()}`;
    const periodId = `${budgetId}_2026M06`;
    await seedPeriod(periodId, budgetId, 500);
    await seedTxn(`t_${budgetId}`, userId, budgetId, 123.45);

    const input = { user_id: userId, budget_ids: [budgetId], transaction_date_ms: JUN_15 };
    await recompute_budget_spent_orchestrator(ctx(), input);
    await recompute_budget_spent_orchestrator(ctx(), input);

    const period = (await db.collection('budget_periods').doc(periodId).get()).data()!;
    expect(period.spent).toBe(123.45); // not 246.90 — recompute, not increment
  });
});
