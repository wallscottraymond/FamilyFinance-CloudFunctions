/**
 * Emulator Integration Tests — Recurring Period Reconciliation (Phase 3)
 *
 * Exercises the reconcile orchestrator end-to-end against the Firestore emulator:
 * resolver (load doc + active periods + linked splits) → domain (align + compute)
 * → repo (update_reconciliation). Covers the fixed-amount path; the variable path
 * is covered by the domain unit tests (its doc-flag wiring is a 3a follow-up).
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
const { Timestamp } = admin.firestore;

import { reconcile_recurring_periods_orchestrator } from "../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator";
import { resolve_recurring_matches } from "../src/functions/resolvers/transactions/recurring_matches.resolver";
import {
  handle_recurring_write,
  transaction_ids_changed,
} from "../src/functions/entry/triggers/on_recurring_updated.trigger";
import { backfill_recurring_reconciliation_orchestrator } from "../src/functions/orchestrators/recurring/backfill_recurring_reconciliation.orchestrator";
import { regenerate_recurring_occurrences_orchestrator } from "../src/functions/orchestrators/recurring/regenerate_recurring_occurrences.orchestrator";
import { assign_recurring_transactions_orchestrator } from "../src/functions/orchestrators/recurring/assign_recurring_transactions.orchestrator";

/* eslint-disable @typescript-eslint/naming-convention */

let _c = 0;
const uniq = (p: string) => `${p}_${Date.now()}_${++_c}_${Math.floor(Math.random() * 1e6)}`;
const ctx = () => ({ trace_id: `t_${Date.now()}_${++_c}`, span_id: `s_${Date.now()}` });
const ts = (y: number, m: number, d: number) => Timestamp.fromMillis(Date.UTC(y, m, d));

interface Payment {
  m: number; // month index 0..2
  d: number;
  amount: number;
  isPending?: boolean;
  isRefund?: boolean;
}

const LAST_DAY = [31, 28, 31];

async function seedBill(opts: {
  expected?: number;
  payments: Payment[];
  lastAmount?: number;
  averageAmount?: number;
}) {
  const expected = opts.expected ?? 2000;
  const userId = uniq("user");
  const accountId = uniq("acct");
  const outflowId = uniq("outflow");
  const batch = db.batch();

  // Jan / Feb / Mar 2026 monthly periods, due on the 1st.
  const periodIds: Record<number, string> = {};
  for (const m of [0, 1, 2]) {
    const pid = `${outflowId}_2026M${String(m + 1).padStart(2, "0")}`;
    periodIds[m] = pid;
    batch.set(db.collection("outflow_periods").doc(pid), {
      id: pid,
      outflowId,
      accountId,
      ownerId: userId,
      userId,
      sourcePeriodId: `2026M${String(m + 1).padStart(2, "0")}`,
      periodStartDate: ts(2026, m, 1),
      periodEndDate: ts(2026, m, LAST_DAY[m]),
      firstDueDateInPeriod: ts(2026, m, 1),
      expectedAmount: expected,
      isActive: true,
      isPaid: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  const txnIds: string[] = []; // Firestore doc ids (for the un-match test)
  const plaidIds: string[] = []; // Plaid transactionIds (the membership list)
  for (const p of opts.payments) {
    const txnId = uniq("txn");
    const plaidId = uniq("ptxn");
    txnIds.push(txnId);
    plaidIds.push(plaidId);
    batch.set(db.collection("transactions").doc(txnId), {
      id: txnId,
      transactionId: plaidId,
      ownerId: userId,
      userId,
      accountId,
      transactionDate: ts(2026, p.m, p.d),
      isActive: true,
      isPending: p.isPending ?? false,
      amount: p.amount,
      splits: [
        {
          splitId: uniq("split"),
          budgetId: "b",
          amount: p.amount,
          outflowId, // engine may or may not set this; membership is the link
          isRefund: p.isRefund ?? false,
        },
      ],
    });
  }

  batch.set(db.collection("outflows").doc(outflowId), {
    id: outflowId,
    ownerId: userId,
    userId,
    groupIds: [],
    accountId,
    isActive: true,
    transactionIds: plaidIds, // PLAID ids (matches production)
    lastAmount: opts.lastAmount ?? expected,
    averageAmount: opts.averageAmount ?? expected,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  await batch.commit();
  return { userId, outflowId, accountId, periodIds, txnIds, plaidIds };
}

const reconcile = (recurring_id: string, user_id: string) =>
  reconcile_recurring_periods_orchestrator(ctx(), {
    recurring_id,
    recurring_type: "outflow",
    user_id,
    trace_id: "t",
  });

const periodDoc = async (id: string) =>
  (await db.collection("outflow_periods").doc(id).get()).data();

// ============================================================================

describe("reconcile_recurring_periods — fixed bill", () => {
  it("marks paid periods complete and an unpaid period none", async () => {
    const bill = await seedBill({
      expected: 2000,
      payments: [
        { m: 0, d: 3, amount: 2000 }, // Jan paid
        { m: 1, d: 2, amount: 2000 }, // Feb paid
      ], // Mar unpaid
    });

    const result = await reconcile(bill.outflowId, bill.userId);
    expect(result.periods_reconciled).toBe(3);

    const jan = await periodDoc(bill.periodIds[0]);
    expect(jan?.reconciliation?.status).toBe("complete");
    expect(jan?.reconciliation?.matchedAmount).toBe(2000);
    expect(jan?.isPaid).toBe(true);
    // The dollar amount the summary/tile reads must reflect the reconciliation.
    expect(jan?.totalAmountPaid).toBe(2000);

    const feb = await periodDoc(bill.periodIds[1]);
    expect(feb?.reconciliation?.status).toBe("complete");

    const mar = await periodDoc(bill.periodIds[2]);
    expect(mar?.reconciliation?.status).toBe("none");
    expect(mar?.isPaid).toBe(false);
  });

  it("partial when under expected, complete when a second payment lands", async () => {
    const bill = await seedBill({
      expected: 2000,
      payments: [{ m: 0, d: 3, amount: 800 }],
    });
    await reconcile(bill.outflowId, bill.userId);
    let jan = await periodDoc(bill.periodIds[0]);
    expect(jan?.reconciliation?.status).toBe("partial");
    expect(jan?.reconciliation?.matchedAmount).toBe(800);

    // Add a second Jan payment that completes it.
    const txn2 = uniq("txn");
    const plaid2 = uniq("ptxn");
    await db.collection("transactions").doc(txn2).set({
      id: txn2,
      transactionId: plaid2,
      ownerId: bill.userId,
      userId: bill.userId,
      accountId: bill.accountId,
      transactionDate: ts(2026, 0, 15),
      isActive: true,
      isPending: false,
      amount: 1200,
      splits: [{ splitId: uniq("split"), budgetId: "b", amount: 1200, outflowId: bill.outflowId, isRefund: false }],
    });
    await db.collection("outflows").doc(bill.outflowId).update({
      transactionIds: [...bill.plaidIds, plaid2],
    });

    await reconcile(bill.outflowId, bill.userId);
    jan = await periodDoc(bill.periodIds[0]);
    expect(jan?.reconciliation?.status).toBe("complete");
    expect(jan?.reconciliation?.matchedAmount).toBe(2000);
  });

  it("pending payment does NOT mark paid (tracked separately)", async () => {
    const bill = await seedBill({
      expected: 2000,
      payments: [{ m: 0, d: 3, amount: 2000, isPending: true }],
    });
    await reconcile(bill.outflowId, bill.userId);
    const jan = await periodDoc(bill.periodIds[0]);
    expect(jan?.reconciliation?.status).toBe("none");
    expect(jan?.reconciliation?.pendingAmount).toBe(2000);
    expect(jan?.isPaid).toBe(false);
  });

  it("refund nets down and reverts a paid period", async () => {
    const bill = await seedBill({
      expected: 2000,
      payments: [
        { m: 0, d: 3, amount: 2000 },
        { m: 0, d: 10, amount: 2000, isRefund: true }, // full refund
      ],
    });
    await reconcile(bill.outflowId, bill.userId);
    const jan = await periodDoc(bill.periodIds[0]);
    expect(jan?.reconciliation?.matchedAmount).toBe(0);
    expect(jan?.reconciliation?.status).toBe("none");
    expect(jan?.isPaid).toBe(false);
  });

  it("a payment marks the bill paid in EVERY overlapping period type", async () => {
    // monthly Jan + bi_monthly Jan-A both contain a Jan-10 payment → both must flip paid.
    const userId = uniq("user");
    const accountId = uniq("acct");
    const outflowId = uniq("outflow");
    const plaidId = uniq("ptxn");
    const txnId = uniq("txn");
    const mP = `${outflowId}_2026M01`;
    const bP = `${outflowId}_2026BM01A`;
    const batch = db.batch();
    batch.set(db.collection("transactions").doc(txnId), {
      id: txnId, transactionId: plaidId, ownerId: userId, userId, accountId,
      transactionDate: ts(2026, 0, 10), isActive: true, isPending: false, amount: 100,
      splits: [{ splitId: uniq("split"), budgetId: "b", amount: 100, outflowId, isRefund: false }],
    });
    for (const [pid, type, endDay] of [[mP, "monthly", 31], [bP, "bi_monthly", 15]] as const) {
      batch.set(db.collection("outflow_periods").doc(pid), {
        id: pid, outflowId, accountId, ownerId: userId, userId, periodType: type,
        periodStartDate: ts(2026, 0, 1), periodEndDate: ts(2026, 0, endDay),
        firstDueDateInPeriod: ts(2026, 0, 1), expectedAmount: 100, isActive: true, isPaid: false,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    }
    batch.set(db.collection("outflows").doc(outflowId), {
      id: outflowId, ownerId: userId, userId, groupIds: [], accountId, isActive: true,
      transactionIds: [plaidId], lastAmount: 100, averageAmount: 100,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await batch.commit();

    await reconcile(outflowId, userId);
    expect((await periodDoc(mP))?.isPaid).toBe(true); // monthly view
    expect((await periodDoc(bP))?.isPaid).toBe(true); // bi-monthly view
  });

  it("tracks BOTH occurrences when a period expects two payments (paid twice / weekly-in-monthly)", async () => {
    // A period with a real occurrenceDueDates array of TWO dates (Jan 1 + Jan 15).
    const userId = uniq("user");
    const accountId = uniq("acct");
    const outflowId = uniq("outflow");
    const pid = `${outflowId}_2026M01`;

    const seed = async (plaidIds: string[], payments: Payment[]) => {
      const batch = db.batch();
      batch.set(db.collection("outflow_periods").doc(pid), {
        id: pid, outflowId, accountId, ownerId: userId, userId, periodType: "monthly",
        periodStartDate: ts(2026, 0, 1), periodEndDate: ts(2026, 0, 31),
        firstDueDateInPeriod: ts(2026, 0, 1),
        amountPerOccurrence: 100,
        occurrenceDueDates: [ts(2026, 0, 1), ts(2026, 0, 15)],
        expectedAmount: 200, isActive: true, isPaid: false,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
      payments.forEach((p, i) => {
        batch.set(db.collection("transactions").doc(uniq("txn")), {
          id: uniq("txn"), transactionId: plaidIds[i], ownerId: userId, userId, accountId,
          transactionDate: ts(2026, p.m, p.d), isActive: true, isPending: false, amount: p.amount,
          splits: [{ splitId: uniq("split"), budgetId: "b", amount: p.amount, outflowId, isRefund: false }],
        });
      });
      batch.set(db.collection("outflows").doc(outflowId), {
        id: outflowId, ownerId: userId, userId, groupIds: [], accountId, isActive: true,
        transactionIds: plaidIds, lastAmount: 100, averageAmount: 100,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
      await batch.commit();
    };

    // Only the first occurrence paid → partial, 1 of 2.
    await seed([uniq("p1")], [{ m: 0, d: 2, amount: 100 }]);
    await reconcile(outflowId, userId);
    let p = (await periodDoc(pid))?.reconciliation;
    expect(p?.status).toBe("partial");
    expect(p?.occurrencesExpected).toBe(2);
    expect(p?.occurrencesPaid).toBe(1);

    // Add the second payment near the 15th → complete, 2 of 2.
    const p1 = uniq("p1b");
    const p2 = uniq("p2b");
    await seed([p1, p2], [{ m: 0, d: 2, amount: 100 }, { m: 0, d: 16, amount: 100 }]);
    await reconcile(outflowId, userId);
    p = (await periodDoc(pid))?.reconciliation;
    expect(p?.status).toBe("complete");
    expect(p?.occurrencesPaid).toBe(2);
    expect(p?.matchedAmount).toBe(200);
  });

  it("variable bill (divergent last vs average) is presence-based — any payment completes it", async () => {
    // last 1500 vs avg 2000 → >10% swing → derived variable → presence-based.
    const bill = await seedBill({
      expected: 2000,
      lastAmount: 1500,
      averageAmount: 2000,
      payments: [{ m: 0, d: 3, amount: 500 }], // well under expected
    });
    await reconcile(bill.outflowId, bill.userId);
    const jan = await periodDoc(bill.periodIds[0]);
    // A FIXED bill would be "partial" here; variable → "complete".
    expect(jan?.reconciliation?.status).toBe("complete");
    expect(jan?.isPaid).toBe(true);
  });

  it("is idempotent — running twice yields identical status", async () => {
    const bill = await seedBill({ expected: 2000, payments: [{ m: 0, d: 3, amount: 2000 }] });
    await reconcile(bill.outflowId, bill.userId);
    const first = (await periodDoc(bill.periodIds[0]))?.reconciliation;
    await reconcile(bill.outflowId, bill.userId);
    const second = (await periodDoc(bill.periodIds[0]))?.reconciliation;
    expect(second.status).toBe(first.status);
    expect(second.matchedAmount).toBe(first.matchedAmount);
  });

  it("un-match reverts the period (removed payment → none)", async () => {
    const bill = await seedBill({ expected: 2000, payments: [{ m: 0, d: 3, amount: 2000 }] });
    await reconcile(bill.outflowId, bill.userId);
    expect((await periodDoc(bill.periodIds[0]))?.reconciliation?.status).toBe("complete");

    // Deactivate the transaction (as a delete would) → reconcile drops it.
    await db.collection("transactions").doc(bill.txnIds[0]).update({ isActive: false });
    await reconcile(bill.outflowId, bill.userId);
    const jan = await periodDoc(bill.periodIds[0]);
    expect(jan?.reconciliation?.status).toBe("none");
    expect(jan?.isPaid).toBe(false);
  });
});

// ============================================================================
// Inflow (income) — matcher + reconcile
// ============================================================================

async function seedIncome(opts: { expected?: number; deposits: Payment[] }) {
  const expected = opts.expected ?? 3000;
  const userId = uniq("user");
  const accountId = uniq("acct");
  const inflowId = uniq("inflow");
  const batch = db.batch();

  const periodIds: Record<number, string> = {};
  for (const m of [0, 1, 2]) {
    const pid = `${inflowId}_2026M${String(m + 1).padStart(2, "0")}`;
    periodIds[m] = pid;
    batch.set(db.collection("inflow_periods").doc(pid), {
      id: pid,
      inflowId,
      accountId,
      ownerId: userId,
      userId,
      merchant: "Acme Payroll",
      sourcePeriodId: `2026M${String(m + 1).padStart(2, "0")}`,
      periodStartDate: ts(2026, m, 1),
      periodEndDate: ts(2026, m, LAST_DAY[m]),
      firstDueDateInPeriod: ts(2026, m, 15),
      expectedAmount: expected,
      isActive: true,
      isPaid: false,
      transactionIds: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  }

  const txnIds: string[] = [];
  const plaidIds: string[] = [];
  for (const p of opts.deposits) {
    const txnId = uniq("txn");
    const plaidId = uniq("ptxn");
    txnIds.push(txnId);
    plaidIds.push(plaidId);
    batch.set(db.collection("transactions").doc(txnId), {
      id: txnId,
      transactionId: plaidId,
      ownerId: userId,
      userId,
      accountId,
      transactionDate: ts(2026, p.m, p.d),
      isActive: true,
      isPending: p.isPending ?? false,
      amount: p.amount,
      splits: [
        { splitId: uniq("split"), budgetId: "b", amount: p.amount, inflowId, isRefund: p.isRefund ?? false },
      ],
    });
  }

  batch.set(db.collection("inflows").doc(inflowId), {
    id: inflowId,
    ownerId: userId,
    userId,
    groupIds: [],
    accountId,
    isActive: true,
    transactionIds: plaidIds,
    lastAmount: expected,
    averageAmount: expected,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  await batch.commit();
  return { userId, inflowId, accountId, periodIds, txnIds };
}

describe("recurring matcher + reconcile — inflow (income)", () => {
  it("matches an income transaction to its inflow (sets inflow_id, not outflow_id)", async () => {
    const inc = await seedIncome({ expected: 3000, deposits: [] });
    const matches = await resolve_recurring_matches(
      ctx(),
      inc.userId,
      "income",
      "Acme Payroll", // merchant match → score ≥ threshold
      Date.UTC(2026, 0, 15),
      [{ split_id: "s1", amount: 3000 }]
    );
    expect(matches.s1.inflow_id).toBe(inc.inflowId);
    expect(matches.s1.outflow_id).toBeNull();
  });

  it("does NOT match an expense transaction to an inflow", async () => {
    const inc = await seedIncome({ expected: 3000, deposits: [] });
    const matches = await resolve_recurring_matches(
      ctx(),
      inc.userId,
      "expense",
      "Acme Payroll",
      Date.UTC(2026, 0, 15),
      [{ split_id: "s1", amount: 3000 }]
    );
    expect(matches.s1.inflow_id).toBeNull();
  });

  it("reconciles an inflow period as received when income posts", async () => {
    const inc = await seedIncome({ expected: 3000, deposits: [{ m: 0, d: 15, amount: 3000 }] });
    const r = await reconcile_recurring_periods_orchestrator(ctx(), {
      recurring_id: inc.inflowId,
      recurring_type: "inflow",
      user_id: inc.userId,
      trace_id: "t",
    });
    expect(r.periods_reconciled).toBe(3);
    const jan = (await db.collection("inflow_periods").doc(inc.periodIds[0]).get()).data();
    expect(jan?.reconciliation?.status).toBe("complete");
    expect(jan?.reconciliation?.matchedAmount).toBe(3000);
    expect(jan?.isPaid).toBe(true);
    // RECEIVED amount must surface for the inflow tile (totalAmountPaid drives totalReceived).
    expect(jan?.totalAmountPaid).toBe(3000);
    expect(jan?.totalAmountDue).toBe(3000);
    const mar = (await db.collection("inflow_periods").doc(inc.periodIds[2]).get()).data();
    expect(mar?.reconciliation?.status).toBe("none");
  });
});

// ============================================================================
// Recurring matcher — OUTFLOW (expense) path. Regression for the field bug:
// get_in_due_window/resolver queried `expectedDueDate` (which v2 outflow_periods
// never set) → no candidates → outflow_id never assigned → budget exclusion broke.
// Now they read `firstDueDateInPeriod` (populated by the v2 generator + regen).
// ============================================================================

describe("recurring matcher — outflow (expense)", () => {
  async function seedOutflowPeriod(merchant: string) {
    const userId = uniq("user");
    const outflowId = uniq("outflow");
    const pid = `${outflowId}_2026M01`;
    await db.collection("outflow_periods").doc(pid).set({
      id: pid, outflowId, ownerId: userId, userId, periodType: "monthly",
      periodStartDate: ts(2026, 0, 1), periodEndDate: ts(2026, 0, 31),
      firstDueDateInPeriod: ts(2026, 0, 15), // the field the matcher must query
      merchantName: merchant, amountPerOccurrence: 89.99, expectedAmount: 89.99,
      isDuePeriod: true, isActive: true, transactionSplits: [],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    return { userId, outflowId, pid };
  }

  it("matches an expense to its outflow via firstDueDateInPeriod (sets outflow_id)", async () => {
    const bill = await seedOutflowPeriod("Comcast");
    const matches = await resolve_recurring_matches(
      ctx(),
      bill.userId,
      "expense",
      "Comcast", // merchant match
      Date.UTC(2026, 0, 16), // one day after the due date, within window
      [{ split_id: "s1", amount: 89.99 }]
    );
    expect(matches.s1.outflow_id).toBe(bill.outflowId);
    expect(matches.s1.inflow_id).toBeNull();
  });

  it("does NOT match an income transaction to an outflow", async () => {
    const bill = await seedOutflowPeriod("Comcast");
    const matches = await resolve_recurring_matches(
      ctx(),
      bill.userId,
      "income",
      "Comcast",
      Date.UTC(2026, 0, 16),
      [{ split_id: "s1", amount: 89.99 }]
    );
    expect(matches.s1.outflow_id).toBeNull();
  });
});

// ============================================================================
// Phase 4 — on_recurring_updated trigger (webhook re-alignment)
// ============================================================================

describe("on_recurring_updated trigger", () => {
  it("field-guard detects transactionIds growth, ignores unchanged / reorder", () => {
    expect(transaction_ids_changed({ transactionIds: ["a"] }, { transactionIds: ["a", "b"] })).toBe(true);
    expect(transaction_ids_changed(null, { transactionIds: ["a"] })).toBe(true);
    expect(transaction_ids_changed({ transactionIds: ["a"] }, { transactionIds: ["a"] })).toBe(false);
    // same set, reordered → not a change
    expect(transaction_ids_changed({ transactionIds: ["a", "b"] }, { transactionIds: ["b", "a"] })).toBe(false);
  });

  it("enqueues a reconcile job when transactionIds grows", async () => {
    const id = uniq("outflow");
    const enqueued = await handle_recurring_write(
      "outflow",
      id,
      { transactionIds: ["t1"] },
      { transactionIds: ["t1", "t2"], userId: uniq("user") },
      uniq("evt")
    );
    expect(enqueued).toBe(true);

    const jobs = await db
      .collection("_jobs")
      .where("job_type", "==", "reconcile_recurring_period")
      .get();
    const mine = jobs.docs.find(
      (dsnap) => (dsnap.data().payload as { recurring_id?: string })?.recurring_id === id
    );
    expect(mine).toBeDefined();
    expect((mine!.data().payload as { recurring_type?: string }).recurring_type).toBe("outflow");
  });

  it("does NOT enqueue when transactionIds is unchanged", async () => {
    const enqueued = await handle_recurring_write(
      "inflow",
      uniq("inflow"),
      { transactionIds: ["t1"] },
      { transactionIds: ["t1"], userId: uniq("user") },
      uniq("evt")
    );
    expect(enqueued).toBe(false);
  });

  it("does NOT enqueue on deletion (after = null)", async () => {
    const enqueued = await handle_recurring_write(
      "outflow",
      uniq("outflow"),
      { transactionIds: ["t1"] },
      null,
      uniq("evt")
    );
    expect(enqueued).toBe(false);
  });
});

// ============================================================================
// Phase 7 — backfill coordinator
// ============================================================================

describe("regenerate_recurring_occurrences (B)", () => {
  it("populates occurrence fields on a legacy period WITHOUT wiping its reconciliation", async () => {
    const userId = uniq("user");
    const accountId = uniq("acct");
    const outflowId = uniq("outflow");
    const srcId = uniq("2026M01"); // unique source-period doc id (period id = outflowId_srcId)
    const periodId = `${outflowId}_${srcId}`;

    // Source period: January 2026 (monthly).
    await db.collection("source_periods").doc(srcId).set({
      periodId: srcId, type: "monthly",
      startDate: ts(2026, 0, 1), endDate: ts(2026, 0, 31),
      year: 2026, index: 0, isCurrent: false,
    });
    // Active monthly outflow, $50, starting Jan 1 2026.
    await db.collection("outflows").doc(outflowId).set({
      id: outflowId, ownerId: userId, userId, groupIds: [], accountId, isActive: true,
      frequency: "MONTHLY", firstDate: ts(2026, 0, 1), lastDate: ts(2026, 0, 1),
      averageAmount: 50, lastAmount: 50, currency: "USD", description: "Legacy bill",
      transactionIds: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    // Existing period with NO occurrence data but an already-reconciled payment state.
    await db.collection("outflow_periods").doc(periodId).set({
      id: periodId, outflowId, accountId, ownerId: userId, userId, periodType: "monthly",
      periodStartDate: ts(2026, 0, 1), periodEndDate: ts(2026, 0, 31),
      isActive: true, isPaid: true,
      reconciliation: { status: "complete", matchedAmount: 50, occurrencesPaid: 1 },
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    const result = await regenerate_recurring_occurrences_orchestrator(ctx(), {
      recurring_id: outflowId, recurring_type: "outflow", user_id: userId, trace_id: "t",
    });
    expect(result.success).toBe(true);
    expect(result.periods_updated).toBe(1);

    const p = (await db.collection("outflow_periods").doc(periodId).get()).data();
    // Occurrence data now populated by the v2 generator...
    expect(p?.numberOfOccurrencesInPeriod).toBe(1);
    expect(Array.isArray(p?.occurrenceDueDates) && p?.occurrenceDueDates.length).toBe(1);
    expect(p?.amountPerOccurrence).toBe(50);
    expect(p?.expectedAmount).toBe(50);
    // ...while the pre-existing reconciliation/payment state is PRESERVED (merge, not overwrite).
    expect(p?.reconciliation?.status).toBe("complete");
    expect(p?.isPaid).toBe(true);

    // A reconcile job was enqueued to recompute against the corrected data.
    const jobs = await db.collection("_jobs")
      .where("job_type", "==", "reconcile_recurring_period").get();
    expect(jobs.docs.some(
      (d) => (d.data().payload as { recurring_id?: string })?.recurring_id === outflowId
    )).toBe(true);
  });
});

describe("assign_recurring_transactions (links a new recurring item's transactions)", () => {
  it("resolves the outflow's Plaid transactionIds → docs and assigns outflowId via the engine", async () => {
    const userId = uniq("user");
    const accountId = uniq("acct");
    const outflowId = uniq("outflow");
    const plaidId = uniq("ptxn");
    const txnId = uniq("txn");
    const spId = uniq("2026M06");

    // Engine needs an Everything-Else budget + a source period covering the txn date.
    await db.collection("budgets").doc(uniq("ee")).set({
      id: uniq("ee"), userId, createdBy: userId, groupIds: [], isActive: true,
      access: { ownerId: userId, createdBy: userId, groupIds: [], isPrivate: true },
      name: "EE", amount: 0, currency: "USD", categoryIds: ["ALL"], period: "monthly",
      startDate: ts(2026, 0, 1), endDate: ts(2027, 0, 1), isOngoing: true,
      isSystemEverythingElse: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await db.collection("source_periods").doc(spId).set({
      periodId: spId, type: "monthly", startDate: ts(2026, 5, 1), endDate: ts(2026, 5, 30), year: 2026,
    });

    // A matchable outflow period (merchant + amount + due date near the txn).
    const pid = `${outflowId}_${spId}`;
    await db.collection("outflow_periods").doc(pid).set({
      id: pid, outflowId, accountId, ownerId: userId, userId, periodType: "monthly",
      periodStartDate: ts(2026, 5, 1), periodEndDate: ts(2026, 5, 30),
      firstDueDateInPeriod: ts(2026, 5, 15), merchantName: "Netflix",
      amountPerOccurrence: 15.99, expectedAmount: 15.99, isDuePeriod: true, isActive: true,
      transactionSplits: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    // The bill payment transaction (Plaid id is the membership key on the outflow).
    await db.collection("transactions").doc(txnId).set({
      id: txnId, transactionId: plaidId, ownerId: userId, userId, accountId,
      transactionType: "expense", transactionDate: ts(2026, 5, 16),
      merchantName: "Netflix", name: "Netflix", isActive: true, isPending: false, amount: 15.99,
      splits: [{
        splitId: uniq("split"), budgetId: "unassigned", amount: 15.99,
        plaidPrimaryCategory: "ENTERTAINMENT", plaidDetailedCategory: "ENTERTAINMENT",
        internalPrimaryCategory: null, internalDetailedCategory: null,
        monthlyPeriodId: null, weeklyPeriodId: null, biWeeklyPeriodId: null,
        isDefault: false, rules: [], tags: [],
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    // The newly-created outflow references the payment by its PLAID id.
    await db.collection("outflows").doc(outflowId).set({
      id: outflowId, ownerId: userId, userId, groupIds: [], accountId, isActive: true,
      merchantName: "Netflix", frequency: "MONTHLY", transactionIds: [plaidId],
      lastAmount: 15.99, averageAmount: 15.99, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    const result = await assign_recurring_transactions_orchestrator(ctx(), {
      recurring_id: outflowId, recurring_type: "outflow", user_id: userId, trace_id: "t",
    });
    expect(result.success).toBe(true);
    expect(result.transactions_assigned).toBe(1);

    const txn = (await db.collection("transactions").doc(txnId).get()).data();
    const s = (txn?.splits ?? [])[0];
    // Engine ran on the resolved transaction → split is assigned a budget (no longer unassigned)...
    expect(s.budgetId).not.toBe("unassigned");
    // ...and linked to the matched outflow (the whole point — budget exclusion needs this).
    expect(s.outflowId).toBe(outflowId);
  });
});

describe("backfill_recurring_reconciliation", () => {
  it("per-user mode enqueues a reconcile_recurring_period per active recurring doc", async () => {
    const bill = await seedBill({ expected: 2000, payments: [{ m: 0, d: 3, amount: 2000 }] });
    const result = await backfill_recurring_reconciliation_orchestrator(ctx(), {
      user_id: bill.userId,
    });
    expect(result.mode).toBe("user");
    expect(result.reconciles_enqueued).toBeGreaterThanOrEqual(1);

    const jobs = await db
      .collection("_jobs")
      .where("job_type", "==", "reconcile_recurring_period")
      .get();
    const mine = jobs.docs.find(
      (d) => (d.data().payload as { recurring_id?: string })?.recurring_id === bill.outflowId
    );
    expect(mine).toBeDefined();
    expect((mine!.data().payload as { recurring_type?: string }).recurring_type).toBe("outflow");
  });
});
