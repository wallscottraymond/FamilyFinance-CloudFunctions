/**
 * Emulator Integration Tests — two budgets with the SAME NAME in two views
 * (Transaction-Integrity proof, cases F5 / F6).
 *
 * Alex has a "Groceries" budget in Me AND the group "The Walls" has its own "Groceries" — both own
 * the groceries category (allowed: one owner per VIEW, canon A3). A transaction counts in exactly
 * ONE view — its account's (the joint account → the group; Alex's Visa → Me). So:
 *   - a $40 groceries purchase on Alex's private Visa → Me Groceries;
 *   - a $100 groceries purchase on the joint account → the group's Groceries;
 *   - a $50 joint-account purchase split 30 / 20 with the 20 PINNED to Alex's ME Groceries → a
 *     pin to another view's budget is ignored (canon A9): both splits count in the GROUP's
 *     Groceries (the app's split form only offers the transaction's own view's budgets).
 * Expected October: Me Groceries 40 · group Groceries 150 — stored == page.
 */

import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "family-budget-app-cb59b" });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const { Timestamp } = admin.firestore;

import {
  get_my_connect_code_orchestrator,
  enter_connect_code_orchestrator,
} from "../src/functions/orchestrators/sharing/connect.orchestrator";
import { get_sharing_overview_orchestrator } from "../src/functions/orchestrators/sharing/connections.orchestrator";
import {
  create_group_orchestrator,
  respond_to_request_orchestrator,
} from "../src/functions/orchestrators/sharing/groups.orchestrator";
import { create_budget_orchestrator } from "../src/functions/orchestrators/budgets/create_budget.orchestrator";
import { derive_period_orchestrator } from "../src/functions/orchestrators/periods/derive_period.orchestrator";
import { createEverythingElseBudget } from "../src/functions/budgets/utils/createEverythingElseBudget";
import { invalidate_category_cache } from "../src/functions/repositories/category.repo";
import { assign_transaction_orchestrator } from "../src/functions/orchestrators/transactions/assign_transaction.orchestrator";
import { account_repo } from "../src/functions/repositories/account.repo";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ALEX = `alex_${RUN}`;
const SAM = `sam_${RUN}`;
const RILEY = `riley_${RUN}`;
const id = (s: string) => `${s}_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const OCT = { start: Date.UTC(2031, 9, 1), end: Date.UTC(2031, 9, 31, 23, 59, 59, 999) };
const NOV = { start: Date.UTC(2031, 10, 1), end: Date.UTC(2031, 10, 30, 23, 59, 59, 999) };
const SHARE_FROM = Date.UTC(2031, 9, 10);

function octx<T>(user_id: string, input: T) {
  return { trace_id: `t_${Math.random()}`, span_id: "s", user_id, input, idempotency_key: `k_${Math.random()}` };
}
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });

async function account(doc_id: string, user: string, name: string, subtype: string) {
  await db.collection("accounts").doc(doc_id).set({
    id: doc_id, userId: user, groupIds: [], isActive: true, isDeleted: false,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(), accountId: `p_${doc_id}`,
    itemId: `item_${user}`, name, accountName: name, mask: doc_id.slice(-4),
    accountType: subtype === "credit card" ? "credit" : "depository", accountSubtype: subtype,
    currentBalance: 0, institutionId: `ins_${doc_id}`, institutionName: "Bank",
  });
}

async function txn(
  key: string, user: string, account_doc: string, amount: number, iso: string, cat: string
) {
  const is_in = cat.startsWith("INCOME") || cat.startsWith("TRANSFER_IN");
  await db.collection("transactions").doc(id(key)).set({
    transactionId: `pt_${id(key)}`, userId: user, ownerId: user, accountId: `p_${account_doc}`,
    isActive: true, isPending: false, transactionDate: ts(iso), type: is_in ? "income" : "expense",
    name: key, merchantName: key, plaidDetailedCategory: cat,
    splits: [{
      splitId: `s_${key}`, amount, plaidPrimaryCategory: cat.split("_")[0], plaidDetailedCategory: cat,
      internalDetailedCategory: null, budgetId: "unassigned", outflowId: null, inflowId: null,
    }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

type Scope = { kind: "me" } | { kind: "group"; group_id: string };
async function oct(user: string, scope?: Scope) {
  return derive_period_orchestrator(t(), user, {
    view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end, force: true, scope,
  });
}
const spent = (r: Awaited<ReturnType<typeof oct>>, pred: (b: { name: string; is_everything_else: boolean }) => boolean) =>
  Math.round(r.budgets.filter(pred).flatMap((b) => b.periods).reduce((s, p) => s + p.spent, 0) * 100) / 100;
const named = (r: Awaited<ReturnType<typeof oct>>, n: string) => spent(r, (b) => b.name === n);

let group_id = "";
let me_groceries_id = "";
let group_groceries_id = "";
const scope = (): Scope => ({ kind: "group", group_id });


beforeAll(async () => {
  for (const u of [ALEX, SAM, RILEY]) {
    await db.collection("users").doc(u).set({ email: `${u}@x.com`, preferences: { currency: "USD" } });
  }
  // October 2031 + its neighbours as monthly source periods.
  for (const [pid, s, e] of [
    ["2031M09", "2031-09-01T00:00:00Z", "2031-09-30T23:59:59.999Z"],
    ["2031M10", "2031-10-01T00:00:00Z", "2031-10-31T23:59:59.999Z"],
    ["2031M11", "2031-11-01T00:00:00Z", "2031-11-30T23:59:59.999Z"],
    ["2031M12", "2031-12-01T00:00:00Z", "2031-12-31T23:59:59.999Z"],
  ]) {
    await db.collection("source_periods").doc(pid).set({ periodId: pid, type: "monthly", startDate: ts(s), endDate: ts(e), year: 2031 });
  }
  await account(id("chk_a"), ALEX, "Checking A", "checking");
  await account(id("visa_a"), ALEX, "Visa A", "credit card");
  await account(id("jc"), ALEX, "Joint Checking", "checking");
  await account(id("chk_s"), SAM, "Checking S", "checking");
  await account(id("amex_s"), SAM, "Amex S", "credit card");
  await createEverythingElseBudget(db, ALEX);
  await createEverythingElseBudget(db, SAM);

  // Real group via the sharing flow.
  const a = (await get_my_connect_code_orchestrator(octx(ALEX, { refresh: true }))).code;
  const s = (await get_my_connect_code_orchestrator(octx(SAM, { refresh: true }))).code;
  await enter_connect_code_orchestrator(octx(ALEX, { code: s }));
  await enter_connect_code_orchestrator(octx(SAM, { code: a }));
  group_id = (await create_group_orchestrator(octx(ALEX, { name: "The Walls", invitee_ids: [SAM] }))).group_id!;
  const req = (await get_sharing_overview_orchestrator(octx(SAM, {} as Record<string, never>))).requests[0];
  await respond_to_request_orchestrator(octx(SAM, { request_id: req.id, accept: true }));

  // Placements (the request/accept flow is covered by sharingPlacement).
  await account_repo.set_placement(t(), id("jc"), { group_id, shared_from_ms: null, shared_by: ALEX, shared_at_ms: SHARE_FROM }, ALEX);
  await account_repo.set_placement(t(), id("amex_s"), { group_id, shared_from_ms: SHARE_FROM, shared_by: SAM, shared_at_ms: SHARE_FROM }, SAM);

  // The categories collection translates Plaid codes to OUR categories; budgets own slugs (A2).
  await db.collection("categories").doc("FOOD_AND_DRINK_GROCERIES").set({
    name: "Groceries", type: "Outflow", isActive: true, overallCategoryId: "food_and_drink",
    firstCategoryId: "groceries", first_category: "Groceries", overall_category: "Food and Drink",
  });
  await db.collection("categories").doc("FOOD_AND_DRINK_COFFEE").set({
    name: "Coffee", type: "Outflow", isActive: true, overallCategoryId: "food_and_drink",
    firstCategoryId: "eating_out", first_category: "Eating out", overall_category: "Food and Drink",
  });
  invalidate_category_cache();

  group_groceries_id = (await create_budget_orchestrator(t(), ALEX, require("crypto").randomUUID(), {
    name: "Groceries", amount: 600, category_ids: ["groceries"], period: "monthly" as never,
    budget_type: "recurring" as never, start_date: "2031-01-01T00:00:00.000Z", alert_threshold: 80,
    is_shared: false, is_ongoing: true, view_group_id: group_id,
  })).budget_id;

  // Alex ALSO has a Me "Groceries" (same name, same category) — allowed: one owner per VIEW.
  me_groceries_id = (await create_budget_orchestrator(t(), ALEX, require("crypto").randomUUID(), {
    name: "Groceries", amount: 300, category_ids: ["groceries"], period: "monthly" as never,
    budget_type: "recurring" as never, start_date: "2031-01-01T00:00:00.000Z", alert_threshold: 80,
    is_shared: false, is_ongoing: true,
  })).budget_id;

  await txn("visa_groc", ALEX, id("visa_a"), 40, "2031-10-06T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
  await txn("jc_groc", ALEX, id("jc"), 100, "2031-10-07T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
  await txn("jc_split", ALEX, id("jc"), 50, "2031-10-08T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
  // The joint-account purchase split 30 / 20, the 20 PINNED to Alex's ME Groceries (another view).
  await db.collection("transactions").doc(id("jc_split")).update({
    splits: [
      { splitId: "x1", amount: 30, plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES", budgetId: "unassigned", outflowId: null, inflowId: null },
      { splitId: "x2", amount: 20, plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: "FOOD_AND_DRINK_GROCERIES", budgetId: me_groceries_id, budgetAssignmentSource: "manual", outflowId: null, inflowId: null },
    ],
  });
  for (const k of ["visa_groc", "jc_groc", "jc_split"]) {
    await assign_transaction_orchestrator(t(), { user_id: ALEX, transaction_id: id(k) });
  }
});


describe("same-named budgets in two views (emulator)", () => {
  it("each purchase counts in its account's view; the two Groceries never mix (page)", async () => {
    expect(named(await oct(ALEX, { kind: "me" }), "Groceries")).toBe(40);
    expect(named(await oct(ALEX, scope()), "Groceries")).toBe(150);
    // Sam sees the same group number.
    expect(named(await oct(SAM, scope()), "Groceries")).toBe(150);
  });

  it("stored == page: the engine stores each split in its view's Groceries; a pin to the OTHER view's budget is ignored", async () => {
    const split = async (k: string) => (await db.collection("transactions").doc(id(k)).get()).data()!.splits;
    expect((await split("visa_groc"))[0].monthlyBudgetId).toBe(me_groceries_id);
    expect((await split("jc_groc"))[0].monthlyBudgetId).toBe(group_groceries_id);
    const s = await split("jc_split");
    expect(s.map((x: { monthlyBudgetId: string }) => x.monthlyBudgetId)).toEqual([group_groceries_id, group_groceries_id]);
    expect(s[1].budgetAssignmentSource).toBe("category"); // the invalid cross-view pin was dropped
  });
});

describe("a bill payment PINNED to a period pays THAT period on the page (as reconcile) (emulator)", () => {
  it("paid Nov 2, pinned to October → October's bill is paid, November's isn't", async () => {
    await db.collection("outflows").doc(id("gym")).set({
      id: id("gym"), ownerId: ALEX, userId: ALEX, createdBy: ALEX, updatedBy: ALEX,
      isActive: true, isHidden: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      plaidItemId: `item_${ALEX}`, accountId: `p_${id("chk_a")}`, lastAmount: 50, averageAmount: 50,
      currency: "USD", description: "gym", merchantName: "gym", payerName: "gym", userCustomName: null,
      frequency: "monthly", firstDate: ts("2031-01-15T00:00:00Z"), lastDate: ts("2031-09-15T00:00:00Z"),
      predictedNextDate: ts("2031-10-15T00:00:00Z"), plaidPrimaryCategory: "PERSONAL_CARE",
      plaidDetailedCategory: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", internalPrimaryCategory: null,
      internalDetailedCategory: null, transactionIds: [], source: "plaid", streamId: id("gym"),
    });
    await txn("gym_pay", ALEX, id("chk_a"), 50, "2031-11-02T12:00:00Z", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS");
    await db.collection("transactions").doc(id("gym_pay")).update({
      splits: [{
        splitId: "g1", amount: 50, plaidPrimaryCategory: "PERSONAL_CARE",
        plaidDetailedCategory: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", budgetId: "unassigned",
        outflowId: id("gym"), outflowAssignmentSource: "manual", outflowPinnedPeriodId: "2031M10", inflowId: null,
      }],
      splitOutflowIds: [id("gym")],
    });
    const paid = (r: Awaited<ReturnType<typeof oct>>) =>
      (r.bills.find((b) => b.recurring_id === id("gym"))?.groups ?? [])
        .reduce((t: number, g: { total_paid: number }) => t + g.total_paid, 0);
    const nov = await derive_period_orchestrator(t(), ALEX, {
      view_cadence: "monthly", window_start_ms: NOV.start, window_end_ms: NOV.end, force: true, scope: { kind: "me" },
    });
    expect(paid(await oct(ALEX, { kind: "me" }))).toBe(50);
    expect(paid(nov)).toBe(0);
  });

  it("an IGNORED split on a bill payment pays nothing on the page (as reconcile nets it)", async () => {
    await db.collection("outflows").doc(id("music")).set({
      id: id("music"), ownerId: ALEX, userId: ALEX, createdBy: ALEX, updatedBy: ALEX,
      isActive: true, isHidden: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      plaidItemId: `item_${ALEX}`, accountId: `p_${id("chk_a")}`, lastAmount: 15, averageAmount: 15,
      currency: "USD", description: "music", merchantName: "music", payerName: "music", userCustomName: null,
      frequency: "monthly", firstDate: ts("2031-01-20T00:00:00Z"), lastDate: ts("2031-09-20T00:00:00Z"),
      predictedNextDate: ts("2031-10-20T00:00:00Z"), plaidPrimaryCategory: "ENTERTAINMENT",
      plaidDetailedCategory: "ENTERTAINMENT_MUSIC_AND_AUDIO", internalPrimaryCategory: null,
      internalDetailedCategory: null, transactionIds: [], source: "plaid", streamId: id("music"),
    });
    await txn("music_pay", ALEX, id("chk_a"), 15, "2031-10-20T12:00:00Z", "ENTERTAINMENT_MUSIC_AND_AUDIO");
    await db.collection("transactions").doc(id("music_pay")).update({
      splits: [{
        splitId: "m1", amount: 15, plaidPrimaryCategory: "ENTERTAINMENT",
        plaidDetailedCategory: "ENTERTAINMENT_MUSIC_AND_AUDIO", budgetId: "unassigned",
        outflowId: id("music"), outflowAssignmentSource: "manual", inflowId: null, spendStatus: "ignored",
      }],
      splitOutflowIds: [id("music")],
    });
    const paid = (r: Awaited<ReturnType<typeof oct>>) =>
      (r.bills.find((b) => b.recurring_id === id("music"))?.groups ?? [])
        .reduce((t: number, g: { total_paid: number }) => t + g.total_paid, 0);
    expect(paid(await oct(ALEX, { kind: "me" }))).toBe(0);
  });
});

