/**
 * AF-08: a posted deposit with the exact payer description links to its income line, even when
 * Plaid hasn't listed it, and Plaid's next stream refresh doesn't drop it. Oct 2033.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern incomeByPayer"
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const { Timestamp } = admin.firestore;

import { link_income_by_payer_orchestrator } from "../src/functions/orchestrators/plaid/link_income_by_payer.orchestrator";
import {
  load_period_derivation_raw,
  shape_period_derivation_deps,
} from "../src/functions/resolvers/periods/period_derivation.resolver";
import { inflow_repo } from "../src/functions/repositories/inflow.repo";

const U = "payer_user";
const ctx = { trace_id: "t", span_id: "s" } as never;
const D = (m: number, d: number) => Date.UTC(2033, m, d);
const NAME = "ACME PAYROLL PPD ID: 123";

async function seed() {
  await db.collection("inflows").doc("pay_line").set({
    id: "pay_line", ownerId: U, userId: U, createdBy: U, groupIds: [], isActive: true, isHidden: false,
    description: NAME, merchantName: "", frequency: "monthly", accountId: "pay_chk", plaidItemId: "item",
    averageAmount: 3000, lastAmount: 3000, currency: "USD",
    firstDate: Timestamp.fromMillis(D(0, 15)), lastDate: Timestamp.fromMillis(D(8, 15)),
    predictedNextDate: Timestamp.fromMillis(D(9, 15)), transactionIds: ["p_sep"],
  });
  const txn = (id: string, name: string, amount: number, date: number, extra: Record<string, unknown> = {}) =>
    db.collection("transactions").doc(id).set({
      transactionId: id, userId: U, ownerId: U, groupIds: [], isActive: true, isDeleted: false, source: "plaid",
      name, description: name, amount, type: "income", accountId: "pay_chk", currency: "USD",
      transactionDate: Timestamp.fromMillis(date), isPending: false, plaidDetailedCategory: "INCOME_SALARY",
      splits: [{ splitId: `${id}_s`, amount, plaidDetailedCategory: "INCOME_SALARY", outflowId: null, inflowId: null }],
      ...extra,
    });
  await txn("p_sep", NAME, 3000, D(8, 15));
  await txn("p_big", NAME, 100236.72, D(9, 15));
  await txn("p_other", "OTHER PAYER", 50, D(9, 16));
  await db.collection("source_periods").doc("2033M10").set({
    id: "2033M10", periodId: "2033M10", type: "monthly",
    startDate: Timestamp.fromMillis(D(9, 1)), endDate: Timestamp.fromMillis(Date.UTC(2033, 9, 31, 23, 59, 59, 999)),
    year: 2033, index: 10,
  });
}

const october = async () => {
  const s = D(9, 1), e = Date.UTC(2033, 9, 31, 23, 59, 59, 999);
  const raw = await load_period_derivation_raw(ctx, U, "monthly", [{ start_ms: s, end_ms: e }]);
  return shape_period_derivation_deps(raw, "monthly", s, e);
};

describe("AF-08: income by exact payer", () => {
  beforeAll(seed);

  it("before: the big deposit is Other Income and the line has no payment", async () => {
    const d = await october();
    expect(d.other_income_credits.map((c) => c.amount).sort((a, b) => a - b)).toEqual([50, 100236.72]);
  });

  it("links it, leaves the other payer alone, and the page counts it once on the line", async () => {
    const docs = (await db.collection("transactions").where("userId", "==", U).get()).docs.map((x) => x.data());
    const r = await link_income_by_payer_orchestrator(ctx, U, "run1", docs);
    expect(r.linked).toEqual(new Map([["pay_line", ["p_big"]]]));
    const line = (await db.collection("inflows").doc("pay_line").get()).data()!;
    expect(line.transactionIds).toEqual(expect.arrayContaining(["p_sep", "p_big"]));
    const split = (await db.collection("transactions").doc("p_big").get()).data()!.splits[0];
    expect(split.inflowId).toBe("pay_line");
    const d = await october();
    expect(d.other_income_credits.map((c) => c.amount)).toEqual([50]);
    const rec = d.recurring.find((x) => x.id === "pay_line")!;
    const paid = rec.payments.reduce((a, p) => a + p.amount, 0);
    expect(paid).toBeCloseTo(100236.72, 2);
  });

  it("is idempotent", async () => {
    const docs = (await db.collection("transactions").where("userId", "==", U).get()).docs.map((x) => x.data());
    expect((await link_income_by_payer_orchestrator(ctx, U, "run2", docs)).linked.size).toBe(0);
  });

  it("Plaid's stream refresh doesn't drop it", async () => {
    const entity = (await inflow_repo.get_by_user_id(ctx, U)).find((l) => l.id === "pay_line")!;
    const plain = {
      ...entity,
      first_date: entity.first_date.toDate(), last_date: entity.last_date.toDate(),
      predicted_next_date: entity.predicted_next_date ? entity.predicted_next_date.toDate() : null,
      transaction_ids: ["p_sep"],
    };
    await inflow_repo.save_batch(ctx, [plain as never], U);
    const line = (await db.collection("inflows").doc("pay_line").get()).data()!;
    expect(line.transactionIds).toEqual(expect.arrayContaining(["p_sep", "p_big"]));
    expect(line.payerMatchedTransactionIds).toEqual(["p_big"]);
  });
});
