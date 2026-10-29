/**
 * Emulator Integration Test — the bill / income detail transaction list (Tappable-Transaction-Rows).
 *
 * The list must (1) identify each payment by its Firestore DOC id (Transaction Detail loads
 * `transactions/{docId}`; the Plaid id can't be opened), (2) include EVERY payment that pays the
 * recurring — Plaid stream members AND splits linked to it (hand-assigned / engine-matched; a
 * manual bill has no stream at all), under the same per-split rule as the period page, and
 * (3) carry the transaction row payload.
 *
 * Cases (one per membership path + each exclusion):
 *   A stream member (doc id ≠ Plaid id)                          → listed by doc id
 *   B split-linked only (not in the stream)                      → listed
 *   C in the stream AND split-linked                             → listed ONCE
 *   D in the stream but its split was detached ("remove from bill") → not listed
 *   E split-linked, two splits, only one paying                  → listed; split_ids + amount = that split
 *   F split-linked but inactive (soft-deleted pending)           → not listed
 *   G another user's transaction linked to the same id           → not listed
 *   H manual bill (no stream) with a hand-pinned payment         → listed
 *   I income: split-linked deposit                               → listed
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern recurringTransactionsList"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();

import { derive_recurring_transactions_orchestrator } from "../src/functions/orchestrators/recurring/derive_recurring_transactions.orchestrator";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `rtl_u_${RUN}`;
const OTHER = `rtl_other_${RUN}`;
const BILL = `rtl_bill_${RUN}`;
const MANUAL_BILL = `rtl_mbill_${RUN}`;
const INCOME = `rtl_inc_${RUN}`;
const id = (k: string) => `rtl_${k}_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const W = { start: Date.parse("2031-08-01T00:00:00Z"), end: Date.parse("2031-08-31T23:59:59.999Z") };

/* eslint-disable @typescript-eslint/naming-convention */
async function recurring(coll: "outflows" | "inflows", docId: string, plaidIds: string[], source = "plaid") {
  await db.collection(coll).doc(docId).set({
    id: docId, ownerId: U, userId: U, createdBy: U, groupIds: [], isActive: true, isHidden: false,
    accountId: "acc_rtl", plaidItemId: "item_rtl", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    averageAmount: 50, lastAmount: 50, currency: "USD", description: docId, merchantName: docId,
    userCustomName: null, frequency: "monthly", firstDate: ts("2031-01-10T00:00:00Z"),
    lastDate: ts("2031-07-10T00:00:00Z"), predictedNextDate: ts("2031-08-10T00:00:00Z"),
    source, transactionIds: plaidIds, removedByUser: false, removalIntervals: [],
  });
}

async function txn(
  key: string,
  opts: {
    owner?: string;
    plaidId?: string;
    amount?: number;
    splits: Array<Record<string, unknown>>;
    isActive?: boolean;
    type?: string;
    date?: string;
  }
) {
  const splits = opts.splits;
  await db.collection("transactions").doc(id(key)).set({
    transactionId: opts.plaidId ?? `p_${id(key)}`,
    userId: opts.owner ?? U, ownerId: opts.owner ?? U, accountId: "acc_rtl",
    isActive: opts.isActive ?? true, isPending: false,
    transactionDate: ts(opts.date ?? "2031-08-10T12:00:00Z"),
    amount: opts.amount ?? splits.reduce((s, x) => s + ((x.amount as number) ?? 0), 0),
    type: opts.type ?? "expense", name: key, merchantName: key,
    splits,
    splitOutflowIds: splits.map((s) => s.outflowId).filter(Boolean),
    splitInflowIds: splits.map((s) => s.inflowId).filter(Boolean),
    initialPlaidData: { big: "raw" },
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const list = (rid: string, kind: "outflow" | "inflow" = "outflow") =>
  derive_recurring_transactions_orchestrator(t(), U, rid, kind, W.start, W.end);

describe("bill / income detail transaction list (emulator)", () => {
  beforeAll(async () => {
    await recurring("outflows", BILL, [`p_${id("A")}`, `p_${id("C")}`, `p_${id("D")}`]);
    await recurring("outflows", MANUAL_BILL, [], "manual");
    await recurring("inflows", INCOME, []);

    await txn("A", { splits: [{ splitId: "a1", amount: 50, isDefault: true, outflowId: null, inflowId: null }] });
    await txn("B", { splits: [{ splitId: "b1", amount: 50, isDefault: true, outflowId: BILL, outflowAssignmentSource: "manual" }] });
    await txn("C", { splits: [{ splitId: "c1", amount: 50, isDefault: true, outflowId: BILL }] });
    await txn("D", { splits: [{ splitId: "d1", amount: 50, isDefault: true, outflowId: null, outflowAssignmentSource: "manual" }] });
    await txn("E", {
      splits: [
        { splitId: "e1", amount: 30, isDefault: true, outflowId: BILL },
        { splitId: "e2", amount: 70, isDefault: false, outflowId: null },
      ],
    });
    await txn("F", { isActive: false, splits: [{ splitId: "f1", amount: 50, isDefault: true, outflowId: BILL }] });
    await txn("G", { owner: OTHER, splits: [{ splitId: "g1", amount: 50, isDefault: true, outflowId: BILL }] });
    await txn("H", { splits: [{ splitId: "h1", amount: 20, isDefault: true, outflowId: MANUAL_BILL, outflowAssignmentSource: "manual" }] });
    await txn("I", {
      type: "income",
      splits: [{ splitId: "i1", amount: 2000, isDefault: true, inflowId: INCOME, outflowId: null }],
    });
  });
  afterAll(async () => { await db.terminate(); });

  it("lists exactly the paying transactions, by DOC id (A, B, C, E — not D, F, G)", async () => {
    const rows = await list(BILL);
    expect(rows.map((r) => r.transaction_id).sort()).toEqual([id("A"), id("B"), id("C"), id("E")].sort());
  });

  it("a transaction in the stream AND split-linked appears once (C)", async () => {
    const rows = await list(BILL);
    expect(rows.filter((r) => r.transaction_id === id("C"))).toHaveLength(1);
  });

  it("only the paying split counts (E: $30 of $100)", async () => {
    const e = (await list(BILL)).find((r) => r.transaction_id === id("E"))!;
    expect(e.split_ids).toEqual(["e1"]);
    expect(e.amount).toBe(30);
  });

  it("a manual bill lists its hand-pinned payment (H)", async () => {
    const rows = await list(MANUAL_BILL);
    expect(rows.map((r) => r.transaction_id)).toEqual([id("H")]);
    expect(rows[0].amount).toBe(20);
  });

  it("income lists a split-linked deposit (I)", async () => {
    const rows = await list(INCOME, "inflow");
    expect(rows.map((r) => r.transaction_id)).toEqual([id("I")]);
  });

  it("each row carries the transaction row payload: doc id, millis dates, no raw Plaid data", async () => {
    const a = (await list(BILL)).find((r) => r.transaction_id === id("A"))!;
    expect(a.card.id).toBe(id("A"));
    expect(typeof a.card.transactionDate).toBe("number");
    expect(a.card).toMatchObject({ ownerId: U, accountId: "acc_rtl", merchantName: "A", amount: 50 });
    expect(a.card).not.toHaveProperty("initialPlaidData");
    expect(a.in_period).toBe(true);
  });
});
