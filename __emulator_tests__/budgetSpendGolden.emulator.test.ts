/**
 * Emulator Integration Test — budget-spend GOLDEN scenario + invalidation ORACLE.
 *
 * The strongest guarantee in the spend pipeline: the event-driven recompute must
 * equal an INDEPENDENT from-scratch re-derivation of the same data. `oracleSpent`
 * below re-sums the raw transaction docs by the countable rule WITHOUT importing
 * `compute_budget_spent` — so if the orchestrator/resolver/repo mis-scopes a
 * period, drops the refund, or double-counts, the oracle catches it.
 *
 * Scenario: one budget (Groceries) with THREE overlapping periods (monthly ∩
 * weekly ∩ bi-monthly) + a second budget (Dining) for isolation. Transactions
 * span a period boundary and include a refund, a transfer, a pending item, a
 * recurring bill (outflow_id), and recurring income (inflow_id).
 *
 * NOTE: all dates are explicit UTC (trailing Z) so period boundaries are exact —
 * mixing UTC-midnight and local-time strings silently shifts the boundary.
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
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const round2 = (n: number) => Math.round(n * 100) / 100;

// Period windows (explicit UTC).
const M_START = '2026-06-01T00:00:00Z';
const M_END = '2026-06-30T23:59:59Z';
const W_START = '2026-06-15T00:00:00Z';
const W_END = '2026-06-21T23:59:59Z';
const BM_START = '2026-06-01T00:00:00Z';
const BM_END = '2026-06-15T23:59:59Z';
// Recompute anchor — noon Jun-15 UTC lands inside all three Groceries windows + Dining monthly.
const ANCHOR_MS = ts('2026-06-15T12:00:00Z').toMillis();

/* eslint-disable @typescript-eslint/naming-convention */
async function seedPeriod(
  id: string, budgetId: string, allocated: number,
  startIso: string, endIso: string, periodType: string
) {
  await db.collection('budget_periods').doc(id).set({
    id, budgetId, periodId: id, periodType,
    periodStart: ts(startIso), periodEnd: ts(endIso),
    allocatedAmount: allocated, rolledOverAmount: 0, spent: 0, remaining: allocated,
    isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
async function seedTxn(
  id: string, userId: string, budgetId: string, amount: number, dateIso: string,
  over: { isPending?: boolean; type?: string; isIgnored?: boolean; outflowId?: string | null; inflowId?: string | null } = {}
) {
  await db.collection('transactions').doc(id).set({
    transactionId: id, userId, isActive: true, transactionDate: ts(dateIso),
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

/**
 * INDEPENDENT oracle — re-derives {spent, pending} for (budget, period) straight
 * from the raw transaction docs. Deliberately does NOT import the domain service.
 */
async function oracleSpent(userId: string, budgetId: string, startMs: number, endMs: number) {
  const snap = await db.collection('transactions').where('userId', '==', userId).get();
  let spent = 0;
  let pending = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.isActive === false) continue;
    const dateMs = (d.transactionDate as Timestamp).toMillis();
    if (dateMs < startMs || dateMs > endMs) continue;
    const isTransfer = d.type === 'transfer';
    for (const s of (d.splits ?? []) as Array<Record<string, unknown>>) {
      if (s.budgetId !== budgetId) continue;
      const countable =
        !isTransfer && !s.isIgnored && s.outflowId == null && s.inflowId == null;
      if (!countable) continue;
      spent += s.amount as number;
      if (d.isPending) pending += s.amount as number;
    }
  }
  return { spent: round2(spent), pending: round2(pending) };
}

async function readPeriod(id: string) {
  const snap = await db.collection('budget_periods').doc(id).get();
  return snap.data()!;
}

describe('budget spend — golden scenario + oracle (emulator)', () => {
  afterAll(async () => { await db.terminate(); });

  it('recompute == independent oracle across overlapping periods + budget isolation, and is idempotent', async () => {
    const userId = uid();
    const tag = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const bG = `bG_${tag}`;   // Groceries
    const bD = `bD_${tag}`;   // Dining

    // Groceries: three overlapping periods that all contain the Jun-15 anchor.
    const gM = `${bG}_M`;   await seedPeriod(gM, bG, 500, M_START, M_END, 'monthly');
    const gW = `${bG}_W`;   await seedPeriod(gW, bG, 120, W_START, W_END, 'weekly');
    const gBM = `${bG}_BM`; await seedPeriod(gBM, bG, 250, BM_START, BM_END, 'bi_monthly');
    // Dining: one monthly period (isolation check).
    const dM = `${bD}_M`;   await seedPeriod(dM, bD, 200, M_START, M_END, 'monthly');

    // Groceries transactions — the Jun-18 items land in monthly+weekly but NOT bi-monthly.
    await seedTxn(`t1_${tag}`, userId, bG, 60, '2026-06-15T12:00:00Z');                            // posted
    await seedTxn(`t2_${tag}`, userId, bG, 40, '2026-06-18T12:00:00Z', { isPending: true });       // pending, past bi-monthly end
    await seedTxn(`t3_${tag}`, userId, bG, 200, '2026-06-15T12:00:00Z', { type: 'transfer' });     // transfer → excluded
    await seedTxn(`t4_${tag}`, userId, bG, -30, '2026-06-15T12:00:00Z');                           // refund → nets down
    await seedTxn(`t5_${tag}`, userId, bG, 300, '2026-06-15T12:00:00Z', { outflowId: 'o1' });      // recurring bill → excluded
    await seedTxn(`t6_${tag}`, userId, bG, 50, '2026-06-18T12:00:00Z', { inflowId: 'i1' });        // recurring income → excluded
    // Dining transaction — must NOT bleed into Groceries.
    await seedTxn(`t7_${tag}`, userId, bD, 25, '2026-06-15T12:00:00Z');

    // Run the real pipeline for both budgets, scoped to the Jun-15 periods.
    const res = await recompute_budget_spent_orchestrator(ctx(), {
      user_id: userId,
      budget_ids: [bG, bD],
      transaction_date_ms: ANCHOR_MS,
    });
    expect(res.periods_updated).toBe(4); // gM, gW, gBM, dM

    // Assert each period against the INDEPENDENT oracle.
    for (const [pid, bid, start, end] of [
      [gM, bG, M_START, M_END],
      [gW, bG, W_START, W_END],
      [gBM, bG, BM_START, BM_END],
      [dM, bD, M_START, M_END],
    ] as const) {
      const expected = await oracleSpent(userId, bid, ts(start).toMillis(), ts(end).toMillis());
      const period = await readPeriod(pid);
      expect(period.spent).toBeCloseTo(expected.spent, 2);
      expect(period.pendingSpent).toBeCloseTo(expected.pending, 2);
    }

    // Explicit overlapping-period expectations (full amount in each; bi-monthly
    // excludes the Jun-18 pending item by date).
    expect((await readPeriod(gM)).spent).toBeCloseTo(70, 2);   // 60 + 40 − 30
    expect((await readPeriod(gM)).pendingSpent).toBeCloseTo(40, 2);
    expect((await readPeriod(gW)).spent).toBeCloseTo(70, 2);   // same window contents
    expect((await readPeriod(gBM)).spent).toBeCloseTo(30, 2);  // 60 − 30 (Jun-18 pending out of range)
    expect((await readPeriod(gBM)).pendingSpent).toBeCloseTo(0, 2);
    expect((await readPeriod(dM)).spent).toBeCloseTo(25, 2);   // isolation — no Groceries bleed

    // Idempotency — re-run yields identical values (recompute, not increment).
    await recompute_budget_spent_orchestrator(ctx(), {
      user_id: userId, budget_ids: [bG, bD], transaction_date_ms: ANCHOR_MS,
    });
    expect((await readPeriod(gM)).spent).toBeCloseTo(70, 2);
    expect((await readPeriod(gW)).spent).toBeCloseTo(70, 2);
    expect((await readPeriod(gBM)).spent).toBeCloseTo(30, 2);
    expect((await readPeriod(dM)).spent).toBeCloseTo(25, 2);
  });
});
