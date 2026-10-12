/**
 * Emulator Integration Tests — transfer pairing at period edges + per-split edge-in income
 * (Transaction-Integrity-Review, 13th review). Same two-person household shape as sharingDerive.
 *
 *   Alex CHK-A sends 500 on Oct 31; it lands in the shared JC on Nov 2 (an ACH gap across the
 *   month boundary). The stored role pairs over ±5 days → edge_out; the period page must pair the
 *   same way: Alex's OCTOBER Me EE counts the 500, and the group's NOVEMBER other income gets it.
 *   Sam sends 300 on Oct 3 into JC; the JC credit is split 200 (left a transfer) + 100 the user
 *   re-categorized to Groceries: the group's other income gets 200, and Groceries nets the 100
 *   exactly once (412 Costco − 100 = 312).
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
import { resolve_transfer_roles } from "../src/functions/resolvers/transactions/transfer_roles.resolver";
import { load_category_catalog } from "../src/functions/resolvers/shared/category_catalog.resolver";
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
const ee = (r: Awaited<ReturnType<typeof oct>>) => spent(r, (b) => b.is_everything_else);
const named = (r: Awaited<ReturnType<typeof oct>>, n: string) => spent(r, (b) => b.name === n);
const other_income = (r: Awaited<ReturnType<typeof oct>>) =>
  Math.round(r.income.filter((i) => i.recurring_id === "__other_income__")
    .flatMap((i) => i.groups).reduce((s, g) => s + g.total_paid, 0) * 100) / 100;

let group_id = "";
const scope = (): Scope => ({ kind: "group", group_id });

async function oct_or_nov(user: string, w: { start: number; end: number }, scope?: Scope) {
  return derive_period_orchestrator(t(), user, {
    view_cadence: "monthly", window_start_ms: w.start, window_end_ms: w.end, force: true, scope,
  });
}

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

  (await create_budget_orchestrator(t(), ALEX, require("crypto").randomUUID(), {
    name: "Groceries", amount: 600, category_ids: ["groceries"], period: "monthly" as never,
    budget_type: "recurring" as never, start_date: "2031-01-01T00:00:00.000Z", alert_threshold: 80,
    is_shared: false, is_ongoing: true, view_group_id: group_id,
  })).budget_id;

  await txn("costco", ALEX, id("jc"), 412, "2031-10-05T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
  await txn("late_out", ALEX, id("chk_a"), 500, "2031-10-31T12:00:00Z", "TRANSFER_OUT_ACCOUNT_TRANSFER");
  await txn("late_in", ALEX, id("jc"), 500, "2031-11-02T12:00:00Z", "TRANSFER_IN_ACCOUNT_TRANSFER");
  await txn("s_out", SAM, id("chk_s"), 300, "2031-10-03T12:00:00Z", "TRANSFER_OUT_ACCOUNT_TRANSFER");
  await txn("s_in", ALEX, id("jc"), 300, "2031-10-03T12:00:00Z", "TRANSFER_IN_ACCOUNT_TRANSFER");
  // The JC credit split: 200 stays the transfer, 100 the user re-categorized to Groceries.
  await db.collection("transactions").doc(id("s_in")).update({
    splits: [
      { splitId: "s_in_a", amount: 200, plaidPrimaryCategory: "TRANSFER_IN", plaidDetailedCategory: "TRANSFER_IN_ACCOUNT_TRANSFER", budgetId: "unassigned", outflowId: null, inflowId: null },
      { splitId: "s_in_b", amount: 100, plaidPrimaryCategory: "TRANSFER_IN", plaidDetailedCategory: "TRANSFER_IN_ACCOUNT_TRANSFER", budgetId: "unassigned", outflowId: null, inflowId: null, categorySource: "user", firstCategoryId: "groceries" },
    ],
  });
});

describe("transfer pairing at period edges + per-split edge-in (emulator)", () => {
  it("a transfer whose other leg lands across the month boundary is edge money on the page (as stored)", async () => {
    // Stored: the classifier pairs over ±5 days → the Oct 31 leg is edge_out, the Nov 2 leg edge_in.
    const roles = await resolve_transfer_roles(t(), ALEX, OCT.start, NOV.end, await load_category_catalog(t()));
    expect(roles.get(id("late_out"))).toBe("edge_out");
    expect(roles.get(id("late_in"))).toBe("edge_in");
    // Page — the same decision: Alex's October Me counts the 500 sent out on Oct 31 as spending.
    expect(ee(await oct_or_nov(ALEX, OCT, { kind: "me" }))).toBe(500);
    // The group's November: the 500 arriving in JC is other income.
    expect(other_income(await oct_or_nov(ALEX, NOV, scope()))).toBe(500);
  });

  it("a 2-split edge-in credit: the transfer part is other income; the re-categorized part nets Groceries once", async () => {
    const g = await oct_or_nov(ALEX, OCT, scope());
    expect(other_income(g)).toBe(200);
    expect(named(g, "Groceries")).toBe(312);
  });
});
