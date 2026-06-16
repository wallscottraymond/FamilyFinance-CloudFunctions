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

  it("delete_history also sets excludeFromBudgets:true", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });

    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "delete_history",
      trace_id: "t",
    });

    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isHidden).toBe(true);
      expect(t?.excludeFromBudgets).toBe(true);
    }
  });

  it("does NOT touch transactions on sibling accounts (cascade isolation)", async () => {
    const seed = await seedAccountGraph(db, { accounts: 2, txnsPerAccount: 2 });
    const sibling = seed.accounts[1];

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
    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "keep_history",
      trace_id: "t",
    });

    // Restore.
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

  it("delete_history exclusion is preserved across restore (user choice persists)", async () => {
    const seed = await seedAccountGraph(db, { accounts: 1, txnsPerAccount: 2 });

    await cascade_hide_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      removal_mode: "delete_history",
      trace_id: "t",
    });
    await restore_account_transactions_orchestrator(ctx(), {
      plaid_account_id: seed.target.accountId,
      user_id: seed.userId,
      trace_id: "t",
    });

    for (const id of seed.txnIdsByAccountId[seed.target.accountId]) {
      const t = await txnDoc(id);
      expect(t?.isActive).toBe(true);
      expect(t?.isHidden).toBe(false);
      // excludeFromBudgets is intentionally NOT reversed by restore.
      expect(t?.excludeFromBudgets).toBe(true);
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
});
