/**
 * A sync's bill/income write never reverts a user edit made during the sync (Code-Health-Review M4-H1).
 *
 * outflow_repo / inflow_repo.save_batch built each doc from a copy read EARLIER (the sync
 * prefetches the stored docs up front) and wrote it back with a full `set()`. A user edit that
 * landed in between (expected amount, Mark as paid, rename, remove) was silently reverted to the
 * prefetched value. The write now re-reads the docs it will change inside a transaction.
 */
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts

import { outflow_repo } from "../src/functions/repositories/outflow.repo";
import { inflow_repo } from "../src/functions/repositories/inflow.repo";
import type {
  OutflowForPersistence,
  InflowForPersistence,
} from "../src/functions/integrations/plaid/plaid_recurring_transformer";

const t = () => ({ trace_id: `t_${Date.now()}`, span_id: "s" });
const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = "u_stale";

/* eslint-disable @typescript-eslint/naming-convention */
const outflow = (id: string, last_amount: number): OutflowForPersistence => ({
  id, owner_id: U, created_by: U, updated_by: U, group_ids: [], plaid_item_id: "item_s",
  plaid_stream_id: id, account_id: "acc_s", last_amount, average_amount: 50, currency: "USD",
  description: "RENT CO", merchant_name: "Rent Co", user_custom_name: null,
  frequency: "monthly" as never, first_date: new Date("2033-01-05"), last_date: new Date("2033-07-05"),
  predicted_next_date: new Date("2033-08-05"), plaid_primary_category: "RENT_AND_UTILITIES",
  plaid_detailed_category: "RENT_AND_UTILITIES_RENT", internal_primary_category: null,
  internal_detailed_category: null, expense_type: "other", is_essential: true,
  status: "active" as never, source: "plaid" as never, plaid_status: "MATURE", plaid_confidence_level: null,
  is_active: true, is_hidden: false, is_user_modified: false, transaction_ids: [], tags: [], rules: [],
});
const inflow = (id: string, last_amount: number): InflowForPersistence => ({
  id, owner_id: U, created_by: U, updated_by: U, group_ids: [], plaid_item_id: "item_s",
  plaid_stream_id: id, account_id: "acc_s", last_amount, average_amount: 2000, currency: "USD",
  description: "PAYROLL", payer_name: "Acme", user_custom_name: null,
  frequency: "biweekly" as never, first_date: new Date("2033-01-02"), last_date: new Date("2033-07-10"),
  predicted_next_date: new Date("2033-07-24"), plaid_primary_category: "INCOME",
  plaid_detailed_category: "INCOME_WAGES", internal_primary_category: null,
  internal_detailed_category: null, income_type: "salary" as never, is_regular_salary: true, is_variable: false,
  status: "active" as never, source: "plaid" as never, plaid_status: "MATURE", plaid_confidence_level: null,
  is_active: true, is_hidden: false, is_user_modified: false, transaction_ids: [], tags: [], rules: [],
});
/* eslint-enable @typescript-eslint/naming-convention */

/** The user's edits, made AFTER the sync read the doc and BEFORE it writes. */
const USER_EDIT = {
  expectedAmountOverride: 99,
  userCustomName: "My rent",
  manualSettledOccurrences: { "2033-08-05": { amount: 99, markedBy: U } },
};

describe.each([
  ["outflows", outflow_repo, outflow, 61],
  ["inflows", inflow_repo, inflow, 2100],
] as const)("%s save_batch with a stale prefetch (M4-H1)", (collection, repo, make, newAmount) => {
  async function staleRun() {
    const id = rid(collection);
    await (repo as typeof outflow_repo).save_batch(t(), [make(id, 50) as never]);
    // The sync reads the stored docs up front…
    const prefetched = new Map([[id, (await db.collection(collection).doc(id).get()).data()!]]);
    // …the user edits the bill while the sync is still running…
    await db.collection(collection).doc(id).update(USER_EDIT);
    // …then the sync writes Plaid's update using its earlier copy.
    const res = await (repo as typeof outflow_repo).save_batch(t(), [make(id, newAmount) as never], "run_1", prefetched);
    return { id, res, doc: (await db.collection(collection).doc(id).get()).data()! };
  }

  it("keeps the user's expected amount, name and Mark-as-paid", async () => {
    const { doc } = await staleRun();
    expect(doc.expectedAmountOverride).toBe(99);
    expect(doc.userCustomName).toBe("My rent");
    expect(doc.manualSettledOccurrences["2033-08-05"]).toMatchObject({ amount: 99 });
  });

  it("still applies Plaid's update", async () => {
    const { doc, res } = await staleRun();
    expect(doc.lastAmount).toBe(newAmount);
    expect(doc.syncRunId).toBe("run_1");
    expect(res.written).toHaveLength(1);
  });

  it("CONTROL: an unchanged stream is still skipped (no write)", async () => {
    const id = rid(collection);
    await (repo as typeof outflow_repo).save_batch(t(), [make(id, 50) as never]);
    const prefetched = new Map([[id, (await db.collection(collection).doc(id).get()).data()!]]);
    const res = await (repo as typeof outflow_repo).save_batch(t(), [make(id, 50) as never], "run_2", prefetched);
    expect(res.written).toHaveLength(0);
  });

  it("CONTROL: a brand-new stream is still created", async () => {
    const id = rid(collection);
    const res = await (repo as typeof outflow_repo).save_batch(t(), [make(id, 50) as never], "run_3", new Map());
    expect(res.written).toHaveLength(1);
    expect(res.written[0].created).toBe(true);
    expect((await db.collection(collection).doc(id).get()).exists).toBe(true);
  });
});
