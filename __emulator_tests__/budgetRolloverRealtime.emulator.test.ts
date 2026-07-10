/**
 * Emulator Integration Test — REAL-TIME rollover wiring (the piece the v2 cutover
 * dropped: previously rollover only recomputed via the 3 AM `calculateDailyRollover`).
 *
 * Two guarantees:
 *  1. `recompute_budget_rollover_orchestrator` recomputes a budget's chain and
 *     persists rolledOverAmount/remaining (delegates to recalculateRolloverChain).
 *  2. THE GATE: `recompute_budget_spent` enqueues a `recalculate_rollover` job
 *     when — and only when — the budget has `rolloverEnabled`. This is the new
 *     hook that makes rollover update in real time as spend changes.
 *
 * Loop-safety is by construction: the chain writes rolledOverAmount/remaining but
 * never `spent`, and rollover jobs are only enqueued from the spend pipeline
 * (driven by transaction writes) — so a rollover write cannot re-enter the pipeline.
 *
 * Prereqs: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { recompute_budget_rollover_orchestrator } from "../src/functions/orchestrators/budgets/recompute_budget_rollover.orchestrator";
import { recompute_budget_spent_orchestrator } from "../src/functions/orchestrators/budgets/recompute_budget_spent.orchestrator";

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const ctx = () => ({ trace_id: `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, span_id: "s" });

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(id: string, userId: string, rolloverEnabled: boolean) {
  await db.collection("budgets").doc(id).set({
    id, userId, createdBy: userId, name: `rt-${id}`, amount: 100,
    period: "monthly", isActive: true,
    rolloverEnabled, rolloverStrategy: "immediate",
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
async function seedPeriod(
  id: string, budgetId: string, allocated: number, spent: number,
  startIso: string, endIso: string
) {
  await db.collection("budget_periods").doc(id).set({
    id, budgetId, periodId: id, periodType: "monthly",
    periodStart: ts(startIso), periodEnd: ts(endIso),
    allocatedAmount: allocated, rolledOverAmount: 0, spent,
    remaining: allocated - spent, isActive: true,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
async function seedTxn(id: string, userId: string, budgetId: string, amount: number, dateIso: string) {
  await db.collection("transactions").doc(id).set({
    transactionId: id, userId, isActive: true, transactionDate: ts(dateIso),
    type: "expense", isPending: false,
    splits: [{ splitId: `${id}_s1`, budgetId, amount, isIgnored: false, outflowId: null, inflowId: null }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

async function rolloverJobsFor(budgetId: string): Promise<number> {
  const snap = await db.collection("_jobs").where("job_type", "==", "recalculate_rollover").get();
  return snap.docs.filter((d) => (d.data().payload as { budget_id?: string })?.budget_id === budgetId).length;
}
const period = async (id: string) => (await db.collection("budget_periods").doc(id).get()).data() as any;

describe("real-time rollover wiring (emulator)", () => {
  afterAll(async () => { await db.terminate(); });

  it("recompute_budget_rollover_orchestrator recomputes + persists the chain", async () => {
    const tag = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const b = `rtOrch_${tag}`;
    const u = `u_${tag}`;
    await seedBudget(b, u, true);
    // P1 underspends by 40; P2 should receive +40.
    await seedPeriod(`${b}_1`, b, 100, 60, "2026-01-01T00:00:00Z", "2026-01-31T23:59:59Z");
    await seedPeriod(`${b}_2`, b, 100, 0, "2026-02-01T00:00:00Z", "2026-02-28T23:59:59Z");

    const res = await recompute_budget_rollover_orchestrator(ctx(), { user_id: u, budget_id: b });

    expect(res.periods_updated).toBe(1); // only P2 changes
    const p2 = await period(`${b}_2`);
    expect(p2.rolledOverAmount).toBe(40);
    expect(p2.remaining).toBe(140); // 100 + 40 - 0
  });

  it("GATE: spend recompute enqueues a rollover job when rolloverEnabled, and NOT when disabled", async () => {
    const tag = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const dateMs = ts("2026-06-15T12:00:00Z").toMillis();

    // Enabled budget → expect a recalculate_rollover job.
    const bOn = `rtOn_${tag}`;
    const uOn = `uOn_${tag}`;
    await seedBudget(bOn, uOn, true);
    await seedPeriod(`${bOn}_M`, bOn, 100, 0, "2026-06-01T00:00:00Z", "2026-06-30T23:59:59Z");
    await seedTxn(`txOn_${tag}`, uOn, bOn, 50, "2026-06-15T12:00:00Z");

    // Disabled budget → expect NO rollover job.
    const bOff = `rtOff_${tag}`;
    const uOff = `uOff_${tag}`;
    await seedBudget(bOff, uOff, false);
    await seedPeriod(`${bOff}_M`, bOff, 100, 0, "2026-06-01T00:00:00Z", "2026-06-30T23:59:59Z");
    await seedTxn(`txOff_${tag}`, uOff, bOff, 50, "2026-06-15T12:00:00Z");

    await recompute_budget_spent_orchestrator(ctx(), {
      user_id: uOn, budget_ids: [bOn], transaction_date_ms: dateMs,
    });
    await recompute_budget_spent_orchestrator(ctx(), {
      user_id: uOff, budget_ids: [bOff], transaction_date_ms: dateMs,
    });

    // Sanity: spend actually recomputed from the seeded txn.
    expect((await period(`${bOn}_M`)).spent).toBe(50);

    expect(await rolloverJobsFor(bOn)).toBeGreaterThanOrEqual(1); // gate fired
    expect(await rolloverJobsFor(bOff)).toBe(0);                   // gate correctly skipped
  });
});
