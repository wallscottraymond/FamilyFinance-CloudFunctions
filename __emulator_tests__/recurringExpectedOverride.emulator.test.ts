/**
 * Stored bill / income periods use the user's expected amount (Code-Health-Review M4-M2 / M1-M5).
 *
 * The period page derives with `expectedAmountOverride ?? averageAmount`, but the resolvers that
 * feed the STORED period generators (generate + regenerate) passed `averageAmount` only, so stored
 * periods (summaries, widgets, the bill period picker, reconcile) kept Plaid's average after the
 * user set their own expected amount.
 */
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts

import { outflow_repo } from "../src/functions/repositories/outflow.repo";
import { inflow_repo } from "../src/functions/repositories/inflow.repo";
import {
  resolve_outflow_period_dependencies,
  resolve_outflow_period_dependencies_from_doc,
} from "../src/functions/resolvers/outflows/outflow_period.resolver";
import {
  resolve_inflow_period_dependencies,
  resolve_inflow_period_dependencies_from_doc,
} from "../src/functions/resolvers/inflows/inflow_period.resolver";
import type {
  OutflowForPersistence,
  InflowForPersistence,
} from "../src/functions/integrations/plaid/plaid_recurring_transformer";

const t = () => ({ trace_id: `t_${Date.now()}`, span_id: "s" });
const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = "u_override";

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

async function seedOutflow(override: number | null) {
  const id = rid("out");
  await outflow_repo.save_batch(t(), [outflow(id, 50)]);
  if (override !== null) await db.collection("outflows").doc(id).update({ expectedAmountOverride: override });
  return { id, doc: (await db.collection("outflows").doc(id).get()).data()! };
}
async function seedInflow(override: number | null) {
  const id = rid("in");
  await inflow_repo.save_batch(t(), [inflow(id, 2000)]);
  if (override !== null) await db.collection("inflows").doc(id).update({ expectedAmountOverride: override });
  return { id, doc: (await db.collection("inflows").doc(id).get()).data()! };
}

describe("period generators get the expected amount (override ?? average)", () => {
  it("bills, from the stored entity: the user's expected amount", async () => {
    const { id } = await seedOutflow(99);
    const deps = await resolve_outflow_period_dependencies(t(), { outflow_id: id } as never);
    expect(deps.outflow.average_amount).toBe(99);
  });
  it("bills, from a trigger's doc: the user's expected amount", async () => {
    const { id, doc } = await seedOutflow(99);
    const deps = await resolve_outflow_period_dependencies_from_doc(t(), id, doc);
    expect(deps.outflow.average_amount).toBe(99);
  });
  it("income, from the stored entity: the user's expected amount", async () => {
    const { id } = await seedInflow(2500);
    const deps = await resolve_inflow_period_dependencies(t(), { inflow_id: id } as never);
    expect(deps.inflow.average_amount).toBe(2500);
  });
  it("income, from a trigger's doc: the user's expected amount", async () => {
    const { id, doc } = await seedInflow(2500);
    const deps = await resolve_inflow_period_dependencies_from_doc(t(), id, doc);
    expect(deps.inflow.average_amount).toBe(2500);
  });
  it("CONTROL: no override → Plaid's average", async () => {
    const o = await seedOutflow(null);
    expect((await resolve_outflow_period_dependencies_from_doc(t(), o.id, o.doc)).outflow.average_amount).toBe(50);
    const i = await seedInflow(null);
    expect((await resolve_inflow_period_dependencies_from_doc(t(), i.id, i.doc)).inflow.average_amount).toBe(2000);
  });
});
