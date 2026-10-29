/**
 * Emulator Integration Test — a removed / paused bill's payments go back to budgets
 * (Transaction-Integrity proof, app action T20 / decision 4c-8, X9).
 *
 * A payment in a month where its bill is removed or paused pays nothing — so it counts as ordinary
 * spending in its category's budget, on the period page AND in the stored assignment (the engine
 * applies the same `is_payment_suppressed` rule). Remove / Restore queue a re-assign of the bill's
 * account so stored totals follow; Restore puts the payment back on the bill.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern recurringRemovalReleases"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();

import { invalidate_category_cache } from "../src/functions/repositories/category.repo";
import { outflow_repo } from "../src/functions/repositories/outflow.repo";
import { derive_period_orchestrator } from "../src/functions/orchestrators/periods/derive_period.orchestrator";
import { assign_transaction_orchestrator } from "../src/functions/orchestrators/transactions/assign_transaction.orchestrator";
import { reassign_user_orchestrator } from "../src/functions/orchestrators/transactions/reassign_user.orchestrator";
import { manage_recurring_removal_orchestrator } from "../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator";
import { resolve_recurring_reconciliation } from "../src/functions/resolvers/recurring/period_reconciliation.resolver";
import { transaction_repo } from "../src/functions/repositories/transaction.repo";
import { derive_recurring_transactions_orchestrator } from "../src/functions/orchestrators/recurring/derive_recurring_transactions.orchestrator";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `rr_u_${RUN}`;
const ENT = `rr_ent_${RUN}`;
const BILL = `rr_bill_${RUN}`;
const PAY = `rr_pay_${RUN}`;
const CODE = `RR_MUSIC_${RUN}`;
const SLUG = `rr_music_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const AUG = { start: Date.parse("2031-08-01T00:00:00Z"), end: Date.parse("2031-08-31T23:59:59.999Z") };

/* eslint-disable @typescript-eslint/naming-convention */
async function budget(id: string, categoryIds: string[], ee = false, period = "monthly") {
  await db.collection("budgets").doc(id).set({
    id, userId: U, createdBy: U, groupIds: [], isActive: true,
    access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
    name: id, amount: 100, currency: "USD", categoryIds, period, budgetType: "recurring",
    startDate: ts("2031-01-01T00:00:00Z"), endDate: ts("2032-01-01T00:00:00Z"),
    isOngoing: true, isSystemEverythingElse: ee, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const page = async () => {
  const r = await derive_period_orchestrator(t(), U, {
    view_cadence: "monthly", window_start_ms: AUG.start, window_end_ms: AUG.end, force: true,
  });
  const spent = Math.round(
    (r.budgets.find((b) => b.budget_id === ENT)?.periods ?? []).reduce((s, p) => s + p.spent, 0) * 100
  ) / 100;
  const bill = r.bills.find((b) => b.recurring_id === BILL);
  const paid = (bill?.groups ?? []).reduce((s: number, g: { total_paid: number }) => s + g.total_paid, 0);
  return { spent, paid, bill_shown: !!bill && (bill.groups ?? []).length > 0 };
};
const split = async () => (await db.collection("transactions").doc(PAY).get()).data()!.splits[0];
const manage = (input: Parameters<typeof manage_recurring_removal_orchestrator>[3]) =>
  manage_recurring_removal_orchestrator(t(), U, [], input, Date.now(), outflow_repo, "recurring_outflow");
const queued_reassign = async () =>
  (await db.collection("_jobs").where("job_type", "==", "reassign_user").get()).docs
    .map((d) => d.data().payload)
    .filter((p) => p?.user_id === U && (p.scope?.account_ids ?? []).includes("acc_rr")).length;

describe("a removed bill's payments count in budgets (emulator)", () => {
  beforeAll(async () => {
    await db.collection("source_periods").doc("2031M08").set({
      periodId: "2031M08", type: "monthly", startDate: ts("2031-08-01T00:00:00Z"),
      endDate: ts("2031-08-31T23:59:59.999Z"), year: 2031,
    });
    await db.collection("categories").doc(CODE).set({
      isActive: true, firstCategoryId: SLUG, overallCategoryId: "entertainment", first_category: "Music",
    });
    invalidate_category_cache();
    await db.collection("users").doc(U).set({ email: "x@x.com" });
    await budget(ENT, [SLUG]);
    await budget(`rr_ee_m_${RUN}`, [], true, "monthly");
    await budget(`rr_ee_w_${RUN}`, [], true, "weekly");
    await budget(`rr_ee_b_${RUN}`, [], true, "bi_monthly");
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection("outflows").doc(BILL).set({
      id: BILL, ownerId: U, userId: U, createdBy: U, groupIds: [], isActive: true, isHidden: false,
      accountId: "acc_rr", plaidItemId: "item_rr", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      averageAmount: 15, lastAmount: 15, currency: "USD", description: "Music", merchantName: "Music",
      userCustomName: null, frequency: "monthly", firstDate: ts("2031-01-20T00:00:00Z"),
      lastDate: ts("2031-07-20T00:00:00Z"), predictedNextDate: ts("2031-08-20T00:00:00Z"),
      plaidPrimaryCategory: "ENTERTAINMENT", plaidDetailedCategory: CODE, source: "plaid",
      transactionIds: [`p_${PAY}`], removedByUser: false, removalIntervals: [],
    });
    await db.collection("transactions").doc(PAY).set({
      transactionId: `p_${PAY}`, userId: U, ownerId: U, accountId: "acc_rr", isActive: true, isPending: false,
      transactionDate: ts("2031-08-20T12:00:00Z"), amount: 15, type: "expense", name: "Music", merchantName: "Music",
      splits: [{
        splitId: "s1", amount: 15, isDefault: true, plaidPrimaryCategory: "ENTERTAINMENT",
        plaidDetailedCategory: CODE, budgetId: "unassigned", outflowId: null, inflowId: null,
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    await assign_transaction_orchestrator(t(), { user_id: U, transaction_id: PAY });
  });
  afterAll(async () => { await db.terminate(); });

  it("active bill: the payment pays the bill and is NOT budget spend (page and stored)", async () => {
    expect((await split()).outflowId).toBe(BILL);
    const p = await page();
    expect(p.paid).toBe(15);
    expect(p.spent).toBe(0);
  });

  it("the paid due date names the transaction that paid it, by DOC id (detail screen opens it)", async () => {
    const r = await derive_period_orchestrator(t(), U, {
      view_cadence: "monthly", window_start_ms: AUG.start, window_end_ms: AUG.end, force: true,
    });
    const occ = (r.bills.find((b) => b.recurring_id === BILL)?.groups ?? []).flatMap((g) => g.occurrences);
    expect(occ.filter((o) => o.paid).map((o) => o.transaction_id)).toEqual([PAY]);
  });

  it("Remove (all time): the payment counts in its budget on the page, and the stored link is released", async () => {
    await manage({ id: BILL, action: "remove", mode: "all" });
    expect((await page()).spent).toBe(15); // page reads the removal directly
    expect(await queued_reassign()).toBeGreaterThan(0); // the account's transactions are re-assigned
    await reassign_user_orchestrator(t(), { user_id: U, reason: "recurring_removal" });
    const s = await split();
    expect(s.outflowId ?? null).toBeNull();
    expect(s.monthlyBudgetId).toBe(ENT);
  });

  it("stored reconcile counts no payment in a removed month (agrees with the page)", async () => {
    const r = await resolve_recurring_reconciliation(t(), { recurring_id: BILL, recurring_type: "outflow" } as never);
    expect(r.splits.map((x) => x.transaction_id)).not.toContain(PAY);
    // …and the bill's transaction list doesn't show it as a payment either.
    const list = await derive_recurring_transactions_orchestrator(t(), U, BILL, "outflow", AUG.start, AUG.end);
    expect(list.map((x) => x.transaction_id)).not.toContain(PAY); // row ids are doc ids
  });

  it("Restore: the payment pays the bill again (page and stored)", async () => {
    await manage({ id: BILL, action: "restore" });
    // Restore is forward-only from this month — the 2031 payment is after it, so it's live again.
    const p = await page();
    expect(p.spent).toBe(0);
    expect(p.paid).toBe(15);
    await reassign_user_orchestrator(t(), { user_id: U, reason: "recurring_removal" });
    expect((await split()).outflowId).toBe(BILL);
    const r = await resolve_recurring_reconciliation(t(), { recurring_id: BILL, recurring_type: "outflow" } as never);
    expect(r.splits.map((x) => x.transaction_id)).toContain(PAY);
    // …and the bill's list shows it again, by DOC id (what Transaction Detail opens).
    const list = await derive_recurring_transactions_orchestrator(t(), U, BILL, "outflow", AUG.start, AUG.end);
    expect(list.map((x) => x.transaction_id)).toContain(PAY);
  });

  it("a MANUAL bill pin survives Remove → Restore (parked, not lost)", async () => {
    // The user pins the payment to the bill by hand (assign-to-bill).
    await transaction_repo.pin_split_to_outflow(t(), PAY, "s1", BILL, U, false, null);
    expect(await split()).toMatchObject({ outflowId: BILL, outflowAssignmentSource: "manual" });
    await manage({ id: BILL, action: "remove", mode: "all" });
    await reassign_user_orchestrator(t(), { user_id: U, reason: "recurring_removal" });
    expect(await split()).toMatchObject({ outflowId: null, suspendedOutflowPinId: BILL });
    expect((await page()).spent).toBe(15); // counts as spending while removed
    await manage({ id: BILL, action: "restore" });
    await reassign_user_orchestrator(t(), { user_id: U, reason: "recurring_removal" });
    expect(await split()).toMatchObject({
      outflowId: BILL, outflowAssignmentSource: "manual", suspendedOutflowPinId: null,
    });
  });
});
