/**
 * Emulator Integration Tests — Account Removal Cascade & Restore
 *
 * Exercises the removal cascade and restore orchestrators directly against the
 * Firestore emulator (no functions emulator), seeded by `seedAccountGraph`.
 * Covers the validation-matrix rows that require real IO:
 *
 *   - Cascade hide transactions (keep_history vs delete_history)
 *   - Cascade isolation (sibling account untouched)
 *   - Cascade soft-delete recurring (outflows + inflows)
 *   - Restore round-trip: transactions re-activated + un-hidden
 *     (regression guard for the bug where restore couldn't find hidden txns
 *      and never reset isActive — fixed 2026-06-09)
 *   - Restore round-trip: recurring outflows/inflows re-activated
 *
 * Prereq: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();

import { cascade_hide_transactions_orchestrator } from "../src/functions/orchestrators/accounts/cascade_hide_transactions.orchestrator";
import { cascade_soft_delete_recurring_orchestrator } from "../src/functions/orchestrators/accounts/cascade_soft_delete_recurring.orchestrator";
import { restore_account_transactions_orchestrator } from "../src/functions/orchestrators/accounts/restore_account_transactions.orchestrator";
import { restore_account_recurring_orchestrator } from "../src/functions/orchestrators/accounts/restore_account_recurring.orchestrator";
import { seedAccountGraph } from "./helpers/seedAccountGraph";

const ctx = () => ({
  trace_id: `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
  span_id: `s_${Date.now()}`,
});

/** Mirror the real flow: remove_account marks the account inactive before queuing the hide job;
 *  restore_account marks it active before queuing the restore job (the jobs check it, P1-M8). */
const setAccountActive = (seed: { target: { id: string } }, isActive: boolean) =>
  db.collection("accounts").doc(seed.target.id).update({ isActive });

const txnDoc = async (id: string) =>
  (await db.collection("transactions").doc(id).get()).data();
const outflowDoc = async (id: string) =>
  (await db.collection("outflows").doc(id).get()).data();
const inflowDoc = async (id: string) =>
  (await db.collection("inflows").doc(id).get()).data();
const outflowPeriodDoc = async (id: string) =>
  (await db.collection("outflow_periods").doc(id).get()).data();
const inflowPeriodDoc = async (id: string) =>
  (await db.collection("inflow_periods").doc(id).get()).data();

// ============================================================================
// Cascade: hide transactions
// ============================================================================

describe("cascade_hide_transactions", () => {
  it("keep_history hides target txns (isActive:false, isHidden:true) without excluding from budgets", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 3 });

    await setAccountActive(seed, false);
    const result = await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "keep_history",
      trace_id: "t",
    });

    expect(result.transactions_hidden).toBe(3);

    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isActive).toBe(false);
      expect(t?.isHidden).toBe(true);
      expect(t?.hiddenReason).toBe("account_removed");
      // keep_history must NOT exclude from budgets
      expect(t?.excludeFromBudgets).toBeUndefined();
    }
  });

  // Decision 2026-10-05 (61144fe): removal_mode is accepted from older builds and ignored;
  // excludeFromBudgets was never read, so it is no longer written.
  it("delete_history is ignored: same result as keep_history (no excludeFromBudgets)", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });

    await setAccountActive(seed, false);

    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "delete_history",
      trace_id: "t",
    });

    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isHidden).toBe(true);
      expect(t?.hiddenReason).toBe("account_removed");
      expect(t?.excludeFromBudgets).toBeUndefined();
    }
  });

  it("does NOT touch transactions on sibling accounts (cascade isolation)", async () => {
    const seed = await seedAccountGraph(db, { accounts: 2, txnsPerAccount: 2 });
    const sibling = seed.accounts[1];

    await setAccountActive(seed, false);

    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "keep_history",
      trace_id: "t",
    });

    for (const id of seed.txnIdsByAccountId[sibling.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isActive).toBe(true);
      expect(t?.isHidden).toBe(false);
    }
  });
});

// ============================================================================
// Cascade: soft-delete recurring
// ============================================================================

describe("cascade_soft_delete_recurring", () => {
  it("soft-deletes the account's outflows and inflows (isActive:false)", async () => {
    const seed = await seedAccountGraph(db, {
      accounts: 1,
      txnsPerAccount: 0,
      outflows: 2,
      inflows: 1,
    });

    const result = await cascade_soft_delete_recurring_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      outflow_ids: seed.outflowIds,
      inflow_ids: seed.inflowIds,
      trace_id: "t",
    });

    expect(result.outflows_deleted).toBe(2);
    expect(result.inflows_deleted).toBe(1);

    for (const id of seed.outflowIds) {
      expect((await outflowDoc(id))?.isActive).toBe(false);
    }
    for (const id of seed.inflowIds) {
      expect((await inflowDoc(id))?.isActive).toBe(false);
    }
  });

  it("also soft-deletes the outflow & inflow PERIODS (isActive:false)", async () => {
    // 2 outflows × 2 periods = 4 outflow periods; 1 inflow × 2 = 2 inflow periods
    const seed = await seedAccountGraph(db, {
      accounts: 1,
      txnsPerAccount: 0,
      outflows: 2,
      inflows: 1,
      periodsPerRecurring: 2,
    });

    const result = await cascade_soft_delete_recurring_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      outflow_ids: seed.outflowIds,
      inflow_ids: seed.inflowIds,
      trace_id: "t",
    });

    expect(result.outflow_periods_deleted).toBe(4);
    expect(result.inflow_periods_deleted).toBe(2);

    for (const id of seed.outflowPeriodIds) {
      expect((await outflowPeriodDoc(id))?.isActive).toBe(false);
    }
    for (const id of seed.inflowPeriodIds) {
      expect((await inflowPeriodDoc(id))?.isActive).toBe(false);
    }
  });
});

// ============================================================================
// Restore round-trip — transactions (regression guard for the restore bug)
// ============================================================================

describe("restore_account_transactions (hide -> restore round-trip)", () => {
  it("re-activates and un-hides transactions that account removal hid", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 3 });

    // Hide (as account removal would).
    await setAccountActive(seed, false);
    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "keep_history",
      trace_id: "t",
    });

    // Restore.
    await setAccountActive(seed, true);
    const result = await restore_account_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      trace_id: "t",
    });

    // Before the fix this returned 0 (hidden txns were invisible to the query).
    expect(result.transactions_restored).toBe(3);

    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isActive).toBe(true);
      expect(t?.isHidden).toBe(false);
    }
  });

  it("restore after delete_history fully restores (removal_mode ignored)", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });

    await setAccountActive(seed, false);

    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "delete_history",
      trace_id: "t",
    });
    await setAccountActive(seed, true);
    await restore_account_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      trace_id: "t",
    });

    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isActive).toBe(true);
      expect(t?.isHidden).toBe(false);
      expect(t?.excludeFromBudgets).toBeUndefined();
    }
  });
});

// ============================================================================
// Restore round-trip — recurring
// ============================================================================

describe("restore_account_recurring (soft-delete -> restore round-trip)", () => {
  it("re-activates the account's outflows, inflows, and their periods", async () => {
    const seed = await seedAccountGraph(db, {
      accounts: 1,
      txnsPerAccount: 0,
      outflows: 2,
      inflows: 1,
      periodsPerRecurring: 2,
    });

    await cascade_soft_delete_recurring_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      outflow_ids: seed.outflowIds,
      inflow_ids: seed.inflowIds,
      trace_id: "t",
    });

    const result = await restore_account_recurring_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      trace_id: "t",
    });

    expect(result.outflows_restored).toBe(2);
    expect(result.inflows_restored).toBe(1);
    expect(result.outflow_periods_restored).toBe(4);
    expect(result.inflow_periods_restored).toBe(2);

    for (const id of seed.outflowIds) {
      expect((await outflowDoc(id))?.isActive).toBe(true);
    }
    for (const id of seed.inflowIds) {
      expect((await inflowDoc(id))?.isActive).toBe(true);
    }
    for (const id of seed.outflowPeriodIds) {
      expect((await outflowPeriodDoc(id))?.isActive).toBe(true);
    }
    for (const id of seed.inflowPeriodIds) {
      expect((await inflowPeriodDoc(id))?.isActive).toBe(true);
    }
  });

  // Code-Health-Review P1-H1 / M4-M8: restore brings back ONLY what the removal turned off. A bill
  // or income the user had already removed (or a period inactive for another reason, e.g. a
  // suppressed occurrence) stays off; restore used to reactivate every inactive one on the account.
  describe("restores only what the removal turned off (P1-H1)", () => {
    async function seedWithUserRemovedBill() {
      const seed = await seedAccountGraph(db, {
        accounts: 1, txnsPerAccount: 0, outflows: 2, inflows: 1, periodsPerRecurring: 2,
      });
      // The user removed bill #0 earlier: it and its periods are already inactive.
      await db.collection("outflows").doc(seed.outflowIds[0]).update({ isActive: false });
      for (const pid of seed.outflowPeriodIds.slice(0, 2)) {
        await db.collection("outflow_periods").doc(pid).update({ isActive: false });
      }
      // One period of the still-active bill #1 is inactive for another reason (suppressed).
      await db.collection("outflow_periods").doc(seed.outflowPeriodIds[2]).update({ isActive: false });
      // One income period is inactive for another reason too.
      await db.collection("inflow_periods").doc(seed.inflowPeriodIds[0]).update({ isActive: false });
      return seed;
    }
    const removeThenRestore = async (seed: Awaited<ReturnType<typeof seedWithUserRemovedBill>>) => {
      await cascade_soft_delete_recurring_orchestrator(ctx(), {
        plaid_account_id: seed.target.accountId, user_id: seed.userId,
        outflow_ids: seed.outflowIds, inflow_ids: seed.inflowIds, trace_id: "t",
      });
      return restore_account_recurring_orchestrator(ctx(), {
        plaid_account_id: seed.target.accountId, user_id: seed.userId, trace_id: "t",
      });
    };

    it("a bill the user had removed stays removed, with its periods", async () => {
      const seed = await seedWithUserRemovedBill();
      await removeThenRestore(seed);
      expect((await outflowDoc(seed.outflowIds[0]))?.isActive).toBe(false);
      for (const pid of seed.outflowPeriodIds.slice(0, 2)) {
        expect((await outflowPeriodDoc(pid))?.isActive).toBe(false);
      }
    });

    it("periods inactive for another reason stay inactive", async () => {
      const seed = await seedWithUserRemovedBill();
      await removeThenRestore(seed);
      expect((await outflowPeriodDoc(seed.outflowPeriodIds[2]))?.isActive).toBe(false);
      expect((await inflowPeriodDoc(seed.inflowPeriodIds[0]))?.isActive).toBe(false);
    });

    it("everything the removal turned off comes back, and the counts say so", async () => {
      const seed = await seedWithUserRemovedBill();
      const result = await removeThenRestore(seed);
      expect((await outflowDoc(seed.outflowIds[1]))?.isActive).toBe(true);
      expect((await inflowDoc(seed.inflowIds[0]))?.isActive).toBe(true);
      expect((await outflowPeriodDoc(seed.outflowPeriodIds[3]))?.isActive).toBe(true);
      expect((await inflowPeriodDoc(seed.inflowPeriodIds[1]))?.isActive).toBe(true);
      expect(result.outflows_restored).toBe(1);
      expect(result.inflows_restored).toBe(1);
      expect(result.outflow_periods_restored).toBe(1);
      expect(result.inflow_periods_restored).toBe(1);
    });

    it("restore clears the removal marker; a second restore changes nothing", async () => {
      const seed = await seedWithUserRemovedBill();
      await removeThenRestore(seed);
      for (const id of seed.outflowIds) expect((await outflowDoc(id))?.deactivatedReason).toBeUndefined();
      for (const id of seed.outflowPeriodIds) expect((await outflowPeriodDoc(id))?.deactivatedReason).toBeUndefined();
      const again = await restore_account_recurring_orchestrator(ctx(), {
        plaid_account_id: seed.target.accountId, user_id: seed.userId, trace_id: "t",
      });
      expect([again.outflows_restored, again.inflows_restored, again.outflow_periods_restored, again.inflow_periods_restored])
        .toEqual([0, 0, 0, 0]);
    });

    it("removal marks exactly what it turned off", async () => {
      const seed = await seedWithUserRemovedBill();
      await cascade_soft_delete_recurring_orchestrator(ctx(), {
        plaid_account_id: seed.target.accountId, user_id: seed.userId,
        outflow_ids: seed.outflowIds, inflow_ids: seed.inflowIds, trace_id: "t",
      });
      expect((await outflowDoc(seed.outflowIds[0]))?.deactivatedReason).toBeUndefined(); // already off
      expect((await outflowDoc(seed.outflowIds[1]))?.deactivatedReason).toBe("account_removed");
      expect((await outflowPeriodDoc(seed.outflowPeriodIds[2]))?.deactivatedReason).toBeUndefined();
      expect((await outflowPeriodDoc(seed.outflowPeriodIds[3]))?.deactivatedReason).toBe("account_removed");
    });
  });
});

// Code-Health-Review P1-M8: hide and restore are page-by-page self-re-enqueueing jobs; a page that
// runs after the account changed state must not undo it.
describe("hide / restore pages respect the account's current state (P1-M8)", () => {
  it("a hide page that runs after the account was restored hides nothing", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 3 });
    await setAccountActive(seed, true); // restored before the queued hide page ran
    const r = await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId, user_id: seed.userId, removal_mode: "keep_history", trace_id: "t",
    });
    expect(r.transactions_hidden).toBe(0);
    expect(r.has_more).toBe(false);
    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      expect((await txnDoc(id))?.isActive).toBe(true);
    }
  });

  it("a restore page that runs after the account was removed again restores nothing", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });
    await setAccountActive(seed, false);
    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId, user_id: seed.userId, removal_mode: "keep_history", trace_id: "t",
    });
    // removed again before the queued restore page ran: account still inactive
    await restore_account_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId, user_id: seed.userId, trace_id: "t",
    });
    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      expect((await txnDoc(id))?.isActive).toBe(false);
    }
  });
});

