/**
 * Emulator Integration Test — stored assignment follows the view (Account-Rooted-Sharing)
 *
 * The "Santo Taco" bug: a restaurant purchase on an account shared with a group was stored as the
 * user's PERSONAL Everything Else, while the group view (derive on read) counted it in the GROUP's
 * "Eating Out and Snacks" budget — so the transaction screen showed "Everything Else". The
 * assignment engine now assigns a shared account's transactions (from its share-from date) against
 * that group's budgets; private-account transactions keep the user's own budgets.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern sharingAssignment"
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
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
import { createEverythingElseBudget } from "../src/functions/budgets/utils/createEverythingElseBudget";
import { account_repo } from "../src/functions/repositories/account.repo";
import { assign_transactions_batch_orchestrator } from "../src/functions/orchestrators/transactions/assign_transactions_batch.orchestrator";

/* eslint-disable @typescript-eslint/naming-convention */
const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ALEX = `alex_${RUN}`;
const SAM = `sam_${RUN}`;
const id = (s: string) => `${s}_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const SHARE_FROM = Date.UTC(2031, 9, 10);
const octx = <T>(user_id: string, input: T) =>
  ({ trace_id: `t_${Math.random()}`, span_id: "s", user_id, input, idempotency_key: `k_${Math.random()}` });
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });

async function account(doc_id: string, user: string) {
  await db.collection("accounts").doc(doc_id).set({
    id: doc_id, userId: user, groupIds: [], isActive: true, isDeleted: false, accountId: `p_${doc_id}`,
    itemId: `item_${user}`, name: doc_id, accountName: doc_id, accountType: "depository", accountSubtype: "checking",
    currentBalance: 0, institutionId: "ins", institutionName: "Bank", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
async function txn(key: string, account_doc: string, iso: string) {
  await db.collection("transactions").doc(id(key)).set({
    transactionId: `pt_${id(key)}`, userId: ALEX, ownerId: ALEX, accountId: `p_${account_doc}`,
    isActive: true, isPending: false, transactionDate: ts(iso), type: "expense",
    name: "POS DEBIT SANTO TACO", merchantName: "Santo Taco", plaidDetailedCategory: "FOOD_AND_DRINK_RESTAURANT",
    splits: [{
      splitId: `s_${key}`, amount: 18.5, plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: "FOOD_AND_DRINK_RESTAURANT",
      internalDetailedCategory: null, budgetId: "unassigned", outflowId: null, inflowId: null,
    }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

let group_id = "";
let group_eating_out = "";

beforeAll(async () => {
  for (const u of [ALEX, SAM]) {
    await db.collection("users").doc(u).set({ email: `${u}@x.com`, preferences: { currency: "USD" } });
  }
  // The detailed Plaid category → the app's "Eating out" first category (budgets store slugs).
  await db.collection("categories").doc("FOOD_AND_DRINK_RESTAURANT").set({
    name: "Restaurants", type: "Outflow", isActive: true, overallCategoryId: "food_and_drink",
    firstCategoryId: "eating_out", first_category: "Eating out", overall_category: "Food and Drink",
  });
  await account(id("chk"), ALEX);   // private
  await account(id("joint"), ALEX); // shared with the group
  await createEverythingElseBudget(db, ALEX);

  const a = (await get_my_connect_code_orchestrator(octx(ALEX, { refresh: true }))).code;
  const s = (await get_my_connect_code_orchestrator(octx(SAM, { refresh: true }))).code;
  await enter_connect_code_orchestrator(octx(ALEX, { code: s }));
  await enter_connect_code_orchestrator(octx(SAM, { code: a }));
  group_id = (await create_group_orchestrator(octx(ALEX, { name: "The Walls", invitee_ids: [SAM] }))).group_id!;
  const req = (await get_sharing_overview_orchestrator(octx(SAM, {} as Record<string, never>))).requests[0];
  await respond_to_request_orchestrator(octx(SAM, { request_id: req.id, accept: true }));
  await account_repo.set_placement(t(), id("joint"), { group_id, shared_from_ms: SHARE_FROM, shared_by: ALEX, shared_at_ms: SHARE_FROM }, ALEX);

  // The group's own budgets: "Eating Out and Snacks" (slug) + its Everything Else.
  await createEverythingElseBudget(db, `group:${group_id}`);
  group_eating_out = id("eat");
  await db.collection("budgets").doc(group_eating_out).set({
    id: group_eating_out, name: "Eating Out and Snacks", userId: `group:${group_id}`, ownerId: `group:${group_id}`,
    createdBy: ALEX, isActive: true, isSystemEverythingElse: false, period: "monthly", amount: 300,
    categoryIds: ["eating_out"], isOngoing: true, budgetType: "recurring", groupIds: [],
    startDate: ts("2031-01-01T00:00:00Z"), endDate: ts("2099-01-01T00:00:00Z"),
  });

  await txn("shared_after", id("joint"), "2031-10-12T00:00:00Z");  // shared account, after share-from
  await txn("shared_before", id("joint"), "2031-10-05T00:00:00Z"); // shared account, before share-from
  await txn("private", id("chk"), "2031-10-12T00:00:00Z");         // private account
}, 60000);

describe("stored assignment follows the view the account counts in", () => {
  it("assigns a shared account's purchase to the GROUP's budget; private + pre-share stay personal", async () => {
    await assign_transactions_batch_orchestrator(t(), {
      user_id: ALEX,
      transaction_ids: [id("shared_after"), id("shared_before"), id("private")],
    });
    const split = async (k: string) => (await db.collection("transactions").doc(id(k)).get()).data()!.splits[0];

    const shared = await split("shared_after");
    expect(shared.monthlyBudgetId ?? shared.budgetId).toBe(group_eating_out);
    expect(shared.budgetName).toBe("Eating Out and Snacks");
    expect(shared.firstCategoryId).toBe("eating_out");

    // Before the share-from date the account's history stays in Me → personal budgets.
    const before = await split("shared_before");
    expect(before.budgetId).not.toBe(group_eating_out);
    const priv = await split("private");
    expect(priv.budgetId).not.toBe(group_eating_out);
    expect(priv.budgetName).toMatch(/Everything Else/);
  }, 60000);

  it("links a payment only to a bill in ITS view (a pre-share payment isn't the group bill's)", async () => {
    // A bill on the joint account (group view) whose Plaid stream claims both payments.
    const bill = id("rent_bill");
    await db.collection("outflows").doc(bill).set({
      id: bill, ownerId: ALEX, userId: ALEX, accountId: `p_${id("joint")}`, isActive: true, isHidden: false,
      description: "Rent", merchantName: "", averageAmount: 18.5, frequency: "monthly",
      transactionIds: [`pt_${id("shared_after")}`, `pt_${id("shared_before")}`],
      plaidPrimaryCategory: "RENT_AND_UTILITIES", plaidDetailedCategory: "RENT_AND_UTILITIES_RENT",
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await assign_transactions_batch_orchestrator(t(), {
      user_id: ALEX,
      transaction_ids: [id("shared_after"), id("shared_before")],
    });
    const split = async (k: string) => (await db.collection("transactions").doc(id(k)).get()).data()!.splits[0];
    expect((await split("shared_after")).outflowId).toBe(bill); // group view: the group's bill
    // Before the share-from date the payment counts in Me, where that bill doesn't live — the
    // period page counts it as spending, so it isn't stored as a bill payment either.
    expect((await split("shared_before")).outflowId ?? null).toBeNull();
    await db.collection("outflows").doc(bill).delete();
  }, 60000);
});
