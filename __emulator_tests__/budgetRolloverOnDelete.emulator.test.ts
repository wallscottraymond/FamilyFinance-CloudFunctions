/**
 * Emulator Integration Test — ROLLOVER-ON-DELETE (#4).
 *
 * When a rollover-enabled budget with pending spread-rollover debt is deleted, the
 * debt must transfer to "Everything Else" instead of vanishing. Verifies:
 *  1. `get_pending_rollover_by_type` aggregates pending debt per period type.
 *  2. `transfer_rollover_to_budget` — immediate (full on EE's current period) and
 *     spread (split across EE's next N periods, remainder on the last) — decrementing
 *     rolledOverAmount and recomputing remaining.
 *  3. End-to-end via `process_budget_deleted_orchestrator` with a transfer payload.
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

import { budget_period_repo } from "../src/functions/repositories/budget_period.repo";
import { process_budget_deleted_orchestrator } from "../src/functions/orchestrators/budgets/process_budget_deleted.orchestrator";

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const ctx = () => ({ trace_id: `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, span_id: "s" });

/* eslint-disable @typescript-eslint/naming-convention */
async function seedPeriod(
  id: string,
  budgetId: string,
  opts: {
    type?: string;
    allocated?: number;
    spent?: number;
    rolledOver?: number;
    startIso?: string;
    endIso?: string;
    pendingDeduction?: number;
    pendingPeriods?: number;
  } = {}
) {
  const allocated = opts.allocated ?? 100;
  const rolledOver = opts.rolledOver ?? 0;
  const spent = opts.spent ?? 0;
  await db.collection("budget_periods").doc(id).set({
    id, budgetId, periodId: id,
    periodType: opts.type ?? "monthly",
    periodStart: ts(opts.startIso ?? "2020-01-01T00:00:00Z"),
    periodEnd: ts(opts.endIso ?? "2999-12-31T23:59:59Z"),
    allocatedAmount: allocated, rolledOverAmount: rolledOver, spent,
    remaining: allocated + rolledOver - spent,
    pendingRolloverDeduction: opts.pendingDeduction ?? 0,
    pendingRolloverPeriods: opts.pendingPeriods ?? 0,
    isActive: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const period = async (id: string) => (await db.collection("budget_periods").doc(id).get()).data() as any;

describe("rollover-on-delete transfer (emulator)", () => {
  afterAll(async () => { await db.terminate(); });

  it("get_pending_rollover_by_type aggregates pending debt per period type", async () => {
    const b = `del_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await seedPeriod(`${b}_m1`, b, { type: "monthly", pendingDeduction: 30, pendingPeriods: 2 });
    await seedPeriod(`${b}_m2`, b, { type: "monthly", pendingDeduction: 30, pendingPeriods: 3 });
    await seedPeriod(`${b}_w1`, b, { type: "weekly", pendingDeduction: 10, pendingPeriods: 1 });
    await seedPeriod(`${b}_m3`, b, { type: "monthly", pendingDeduction: 0, pendingPeriods: 0 }); // ignored

    const result = await budget_period_repo.get_pending_rollover_by_type(ctx(), b);

    const monthly = result.find((r) => r.period_type === "monthly");
    const weekly = result.find((r) => r.period_type === "weekly");
    expect(monthly).toEqual({ period_type: "monthly", amount: 60, periods: 3 }); // sum amount, max periods
    expect(weekly).toEqual({ period_type: "weekly", amount: 10, periods: 1 });
    expect(result.length).toBe(2);
  });

  it("transfer immediate → full deduction lands on EE's current period", async () => {
    const ee = `ee_imm_${Date.now()}`;
    await seedPeriod(`${ee}_m`, ee, { type: "monthly", allocated: 100 });

    const affected = await budget_period_repo.transfer_rollover_to_budget(
      ctx(), ee, [{ period_type: "monthly", amount: 60, periods: 3 }], "immediate"
    );

    expect(affected.length).toBe(1);
    const p = await period(`${ee}_m`);
    expect(p.rolledOverAmount).toBe(-60); // full amount, ignores periods for immediate
    expect(p.remaining).toBe(40); // 100 - 60 - 0
  });

  it("transfer spread → split across EE's next N periods, remainder on the last", async () => {
    const ee = `ee_spr_${Date.now()}`;
    await seedPeriod(`${ee}_1`, ee, { type: "monthly", allocated: 100, startIso: "2020-01-01T00:00:00Z", endIso: "2999-01-01T00:00:00Z" });
    await seedPeriod(`${ee}_2`, ee, { type: "monthly", allocated: 100, startIso: "2999-01-02T00:00:00Z", endIso: "2999-06-01T00:00:00Z" });
    await seedPeriod(`${ee}_3`, ee, { type: "monthly", allocated: 100, startIso: "2999-06-02T00:00:00Z", endIso: "2999-12-31T00:00:00Z" });

    const affected = await budget_period_repo.transfer_rollover_to_budget(
      ctx(), ee, [{ period_type: "monthly", amount: 61, periods: 3 }], "spread"
    );

    expect(affected.length).toBe(3);
    const p1 = await period(`${ee}_1`);
    const p2 = await period(`${ee}_2`);
    const p3 = await period(`${ee}_3`);
    // 61/3 → 20.33 each; last carries the remainder so the shares sum to exactly 61.
    expect(p1.rolledOverAmount).toBe(-20.33);
    expect(p2.rolledOverAmount).toBe(-20.33);
    expect(p3.rolledOverAmount).toBe(-20.34);
    expect(Math.round((p1.rolledOverAmount + p2.rolledOverAmount + p3.rolledOverAmount) * 100) / 100).toBe(-61);
  });

  it("end-to-end: process_budget_deleted transfers pending rollover to EE", async () => {
    const ee = `ee_e2e_${Date.now()}`;
    await seedPeriod(`${ee}_m`, ee, { type: "monthly", allocated: 200 });

    await process_budget_deleted_orchestrator(ctx(), {
      budget_id: `deleted_${Date.now()}`,
      user_id: `u_${Date.now()}`,
      group_ids: [],
      budget_period_ids: [], // already deleted — cascade skips period deletion
      affected_transaction_ids: [],
      release_category_ids: [],
      everything_else_budget_id: ee,
      rollover_transfer_mode: "immediate",
      pending_rollover_by_type: [{ period_type: "monthly", amount: 40, periods: 2 }],
    });

    const p = await period(`${ee}_m`);
    expect(p.rolledOverAmount).toBe(-40);
    expect(p.remaining).toBe(160); // 200 - 40
  });
});
