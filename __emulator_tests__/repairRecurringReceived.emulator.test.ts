/**
 * scripts/repair-recurring-received.js (Code-Health-Review F1 / F3 repair), on the emulator.
 *
 * A retired legacy matcher overwrote a period's totals but not its `reconciliation` fingerprint,
 * so re-running reconcile leaves the damage (F2). The script compares reconcile's own result to
 * the stored totals: a dry run reports and writes nothing; --commit restores reconcile's numbers
 * for the damaged periods only.
 */
import * as admin from "firebase-admin";
import { execFileSync } from "child_process";
import * as path from "path";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

import { reconcile_recurring_periods_orchestrator } from "../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `rr_u_${RUN}`;
const OUT = `rr_out_${RUN}`;
const ts = (m: number, d: number) => Timestamp.fromMillis(Date.UTC(2026, m, d));
const pid = (m: number) => `${OUT}_2026M${String(m + 1).padStart(2, "0")}`;
const read = async (id: string) => (await db.collection("outflow_periods").doc(id).get()).data()!;
const script = (args: string[]) => execFileSync(
  "node", [path.join(__dirname, "../scripts/repair-recurring-received.js"), "--type", "outflow", "--user", U, ...args],
  { env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: "" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);

/* eslint-disable @typescript-eslint/naming-convention */
beforeAll(async () => {
  const batch = db.batch();
  const last = [31, 28];
  for (const m of [0, 1]) {
    batch.set(db.collection("outflow_periods").doc(pid(m)), {
      id: pid(m), outflowId: OUT, accountId: "rr_acct", ownerId: U, userId: U,
      sourcePeriodId: `2026M0${m + 1}`, periodStartDate: ts(m, 1), periodEndDate: ts(m, last[m]),
      firstDueDateInPeriod: ts(m, 1), expectedAmount: 50, isActive: true, isPaid: false,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  }
  batch.set(db.collection("transactions").doc(`rr_txn_${RUN}`), {
    id: `rr_txn_${RUN}`, transactionId: `rr_ptxn_${RUN}`, ownerId: U, userId: U, accountId: "rr_acct",
    transactionDate: ts(0, 3), isActive: true, isPending: false, amount: 50,
    splits: [{ splitId: "s1", budgetId: "b", amount: 50, outflowId: OUT, isRefund: false }],
  });
  batch.set(db.collection("outflows").doc(OUT), {
    id: OUT, ownerId: U, userId: U, groupIds: [], accountId: "rr_acct", isActive: true,
    transactionIds: [`rr_ptxn_${RUN}`], lastAmount: 50, averageAmount: 50,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  await batch.commit();
  await reconcile_recurring_periods_orchestrator({ trace_id: "t", span_id: "s" },
    { recurring_id: OUT, recurring_type: "outflow", user_id: U, trace_id: "t" });
  // The legacy matcher's damage: Jan double-credited, Feb marked paid with nothing linked.
  await db.collection("outflow_periods").doc(pid(0)).update({ totalAmountPaid: 100, amountPaid: 100 });
  await db.collection("outflow_periods").doc(pid(1)).update({
    totalAmountPaid: 50, isPaid: true, isFullyPaid: true, numberOfOccurrencesPaid: 1,
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
afterAll(async () => { await db.terminate(); });

describe("repair-recurring-received (emulator)", () => {
  it("re-running reconcile alone leaves the damage (F2: fingerprint unchanged)", async () => {
    await reconcile_recurring_periods_orchestrator({ trace_id: "t2", span_id: "s" },
      { recurring_id: OUT, recurring_type: "outflow", user_id: U, trace_id: "t2" });
    expect((await read(pid(0))).totalAmountPaid).toBe(100);
    expect((await read(pid(1))).isFullyPaid).toBe(true);
  });

  it("a dry run reports both periods and writes nothing", async () => {
    const out = script([]);
    expect(out).toContain(`${pid(0)} (${U}): totalAmountPaid 100.00 → 50.00`);
    expect(out).toContain(`${pid(1)} (${U}): totalAmountPaid 50.00 → 0.00; isFullyPaid true → false`);
    expect((await read(pid(0))).totalAmountPaid).toBe(100);
  });

  it("--commit restores reconcile's numbers; a second run finds nothing", async () => {
    script(["--commit"]);
    const jan = await read(pid(0));
    const feb = await read(pid(1));
    expect(jan).toMatchObject({ totalAmountPaid: 50, amountPaid: 50, isFullyPaid: true, numberOfOccurrencesPaid: 1 });
    expect(feb).toMatchObject({ totalAmountPaid: 0, isPaid: false, isFullyPaid: false, numberOfOccurrencesPaid: 0 });
    const again = script([]);
    expect(again).not.toContain(`${pid(0)} (`);
    expect(again).not.toContain(`${pid(1)} (`);
  });
});
