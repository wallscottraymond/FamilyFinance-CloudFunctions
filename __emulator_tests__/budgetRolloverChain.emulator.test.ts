/**
 * Emulator Integration Test — budget ROLLOVER CHAIN (the feature is dormant in
 * prod: 0 budgets have rolloverEnabled, 0 periods carry a rolledOverAmount, so
 * it has never been exercised on real data). This test enables rollover on a
 * seeded budget, drives spend across a period chain, runs the SAME functions the
 * deployed 3 AM job calls (`recalculateRolloverChain` /
 * `recalculateRolloverForCurrentPeriods`), and asserts the persisted
 * rolledOverAmount + remaining against HAND-COMPUTED expected values.
 *
 * The expected numbers below were derived by manually stepping the documented
 * contract (rolloverCalculation.ts), NOT by re-running the code — so a wiring,
 * persistence, sort-order, remaining-formula, or enabled/disabled bug is caught.
 *
 * Contract recap (per period, same type, sequential):
 *   prevEffective   = prevAllocated + prevRolledOver
 *   surplusDeficit  = prevEffective - prevSpent
 *   immediate: rolledOver = surplusDeficit (full)
 *   spread:    on deficit, rolledOver = -round(deficit / spreadPeriods),
 *              pendingDeduction = deficit - perPeriod, pendingPeriods = spread-1
 *   remaining  = allocated + rolledOver - spent   (may be negative)
 *   first period (no previous) always rolledOver = 0
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
  recalculateRolloverChain,
  recalculateRolloverForCurrentPeriods,
} from '../src/functions/budgets/utils/rolloverChainCalculation';

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const round2 = (n: number) => Math.round(n * 100) / 100;

interface SeedPeriod {
  allocated: number;
  spent: number;
  startIso: string;
  endIso: string;
  rolledOver?: number;
}

async function seedBudget(
  id: string,
  cfg: { enabled: boolean; strategy?: 'immediate' | 'spread'; spread?: number }
) {
  await db.collection('budgets').doc(id).set({
    id,
    userId: `u_${id}`,
    createdBy: `u_${id}`,
    name: `rollover-test-${id}`,
    amount: 100,
    period: 'monthly',
    isActive: true,
    rolloverEnabled: cfg.enabled,
    ...(cfg.strategy ? { rolloverStrategy: cfg.strategy } : {}),
    ...(cfg.spread ? { rolloverSpreadPeriods: cfg.spread } : {}),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

/** Seeds a period the way the spend pipeline would leave it: remaining = allocated - spent. */
async function seedPeriod(id: string, budgetId: string, p: SeedPeriod) {
  const rolledOver = p.rolledOver ?? 0;
  await db.collection('budget_periods').doc(id).set({
    id,
    budgetId,
    periodId: id,
    periodType: 'monthly',
    periodStart: ts(p.startIso),
    periodEnd: ts(p.endIso),
    allocatedAmount: p.allocated,
    spent: p.spent,
    rolledOverAmount: rolledOver,
    remaining: round2(p.allocated + rolledOver - p.spent),
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

async function getPeriod(id: string) {
  const doc = await db.collection('budget_periods').doc(id).get();
  return doc.data() as any;
}

describe('budget rollover chain (emulator)', () => {
  it('IMMEDIATE: underspend surplus carries forward through the chain', async () => {
    const b = 'immUnder';
    await seedBudget(b, { enabled: true, strategy: 'immediate' });
    // P1 allocated 100 spent 60 -> surplus 40 (no prev, rollover 0)
    await seedPeriod(`${b}_1`, b, { allocated: 100, spent: 60, startIso: '2026-01-01T00:00:00Z', endIso: '2026-01-31T23:59:59Z' });
    // P2 allocated 100 spent 130 -> receives +40 from P1
    await seedPeriod(`${b}_2`, b, { allocated: 100, spent: 130, startIso: '2026-02-01T00:00:00Z', endIso: '2026-02-28T23:59:59Z' });
    // P3 allocated 100 spent 0 -> P2 effective 140, spent 130, surplus 10 -> +10
    await seedPeriod(`${b}_3`, b, { allocated: 100, spent: 0, startIso: '2026-03-01T00:00:00Z', endIso: '2026-03-31T23:59:59Z' });

    const res = await recalculateRolloverChain(db, b);
    expect(res.success).toBe(true);

    const p1 = await getPeriod(`${b}_1`);
    const p2 = await getPeriod(`${b}_2`);
    const p3 = await getPeriod(`${b}_3`);

    expect(p1.rolledOverAmount).toBe(0);
    expect(p1.remaining).toBe(40); // seeded, unchanged (no rollover)

    expect(p2.rolledOverAmount).toBe(40);
    expect(p2.rolledOverFromPeriodId).toBe(`${b}_1`);
    expect(p2.remaining).toBe(10); // 100 + 40 - 130

    expect(p3.rolledOverAmount).toBe(10);
    expect(p3.remaining).toBe(110); // 100 + 10 - 0
  });

  it('IMMEDIATE: overspend produces a negative rollover and negative remaining', async () => {
    const b = 'immOver';
    await seedBudget(b, { enabled: true, strategy: 'immediate' });
    // P1 spent exactly to allocation -> surplus 0
    await seedPeriod(`${b}_1`, b, { allocated: 100, spent: 100, startIso: '2026-01-01T00:00:00Z', endIso: '2026-01-31T23:59:59Z' });
    // P2 heavy overspend (250). P1 surplus 0 -> P2 rollover 0, remaining -150
    await seedPeriod(`${b}_2`, b, { allocated: 100, spent: 250, startIso: '2026-02-01T00:00:00Z', endIso: '2026-02-28T23:59:59Z' });
    // P3: P2 effective 100, spent 250, deficit -150 (immediate) -> P3 rollover -150, remaining -50
    await seedPeriod(`${b}_3`, b, { allocated: 100, spent: 0, startIso: '2026-03-01T00:00:00Z', endIso: '2026-03-31T23:59:59Z' });

    const res = await recalculateRolloverChain(db, b);
    expect(res.success).toBe(true);

    const p2 = await getPeriod(`${b}_2`);
    const p3 = await getPeriod(`${b}_3`);

    expect(p2.rolledOverAmount).toBe(0);
    expect(p2.remaining).toBe(-150); // seeded (no change)

    expect(p3.rolledOverAmount).toBe(-150);
    expect(p3.remaining).toBe(-50); // 100 - 150 - 0  (negative remaining supported)
  });

  it('SPREAD: overspend distributes deficit/spreadPeriods and records the pending remainder', async () => {
    const b = 'spread';
    await seedBudget(b, { enabled: true, strategy: 'spread', spread: 3 });
    // P1 overspends by 90 (no prev -> rollover 0, remaining -90)
    await seedPeriod(`${b}_1`, b, { allocated: 100, spent: 190, startIso: '2026-01-01T00:00:00Z', endIso: '2026-01-31T23:59:59Z' });
    // P2 (spent 0): P1 deficit 90, spread/3 -> first deduction 30, pending 60 over 2
    await seedPeriod(`${b}_2`, b, { allocated: 100, spent: 0, startIso: '2026-02-01T00:00:00Z', endIso: '2026-02-28T23:59:59Z' });

    const res = await recalculateRolloverChain(db, b);
    expect(res.success).toBe(true);

    const p2 = await getPeriod(`${b}_2`);
    expect(p2.rolledOverAmount).toBe(-30); // -round(90/3)
    expect(p2.pendingRolloverDeduction).toBe(60); // 90 - 30
    expect(p2.pendingRolloverPeriods).toBe(2); // spread - 1
    expect(p2.remaining).toBe(70); // 100 - 30 - 0
  });

  it('DISABLED: a stale rolledOverAmount is cleared and remaining reverts to allocated - spent', async () => {
    const b = 'disabled';
    await seedBudget(b, { enabled: false });
    await seedPeriod(`${b}_1`, b, { allocated: 100, spent: 20, startIso: '2026-01-01T00:00:00Z', endIso: '2026-01-31T23:59:59Z' });
    // P2 carries a STALE rollover of 99 that must be cleared
    await seedPeriod(`${b}_2`, b, { allocated: 100, spent: 40, rolledOver: 99, startIso: '2026-02-01T00:00:00Z', endIso: '2026-02-28T23:59:59Z' });

    const res = await recalculateRolloverChain(db, b);
    expect(res.success).toBe(true);

    const p2 = await getPeriod(`${b}_2`);
    expect(p2.rolledOverAmount).toBe(0);
    expect(p2.remaining).toBe(60); // 100 - 40 (rollover stripped)
  });

  it('DAILY ENTRY: recalculateRolloverForCurrentPeriods finds the current period and computes its chain', async () => {
    const b = 'daily';
    await seedBudget(b, { enabled: true, strategy: 'immediate' });
    // Past period: underspend by 25 -> should roll +25 into the current period
    await seedPeriod(`${b}_1`, b, { allocated: 100, spent: 75, startIso: '2020-01-01T00:00:00Z', endIso: '2020-01-31T23:59:59Z' });
    // "Current" period: window straddles now (wide range) so the daily query matches it
    await seedPeriod(`${b}_2`, b, { allocated: 100, spent: 10, startIso: '2020-02-01T00:00:00Z', endIso: '2999-12-31T23:59:59Z' });

    const res = await recalculateRolloverForCurrentPeriods(db);
    expect(res.errors).toEqual([]);
    expect(res.budgetsProcessed).toBeGreaterThanOrEqual(1);

    const p2 = await getPeriod(`${b}_2`);
    expect(p2.rolledOverAmount).toBe(25); // P1 effective 100, spent 75 -> surplus 25
    expect(p2.remaining).toBe(115); // 100 + 25 - 10
  });
});
