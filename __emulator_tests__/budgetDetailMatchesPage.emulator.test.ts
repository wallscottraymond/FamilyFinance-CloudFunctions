/**
 * Budget Detail's list and total must equal the period page's number, for every budget, in every
 * cadence (Trustworthy-Numbers AF-07: "clicking into the budget detail pages matches what's on the
 * charts"). Both now read ONE counting decision (shape_period_derivation_deps).
 *
 * Hand-computed, Oct 2032 (far from other suites), monthly Everything Else:
 *   coffee 10.00                                     counts
 *   return 3.00 (credit, spending category)          nets −3.00
 *   DoorDash 17.03, linked to a bill REMOVED from Oct counts (the payment is released)
 *   Gym 50.00, in a live bill's Plaid stream, no link  bill, not budget
 *   Rent 900.00, linked to a live bill               bill, not budget
 *   Card payment 772: checking + card, both in view  neither side
 *   Card payment 200 ignored on checking, card credit stays: neither side
 *   Amazon card 300, card not linked                 counts
 *   → 10 − 3 + 17.03 + 300 = 324.03
 * Three legs of $500 (out Oct 21, in on the card Oct 24, out Oct 28): monthly pairs the first two,
 * so 500 counts (824.03); the week of Oct 28 can't see Oct 21, pairs the last two, so 0 counts. The page's own
 * greedy pairing differs by view, and Detail must equal the view it's opened from.
 * Gift 25 is pinned to a real budget, which owns it on both.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern budgetDetailMatchesPage"
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const { Timestamp } = admin.firestore;

import { derive_budget_transactions_orchestrator } from "../src/functions/orchestrators/budgets/derive_budget_transactions.orchestrator";
import {
  load_period_derivation_raw,
  shape_period_derivation_deps,
} from "../src/functions/resolvers/periods/period_derivation.resolver";
import { owned_splits_for_budget } from "../src/functions/domain/budgets/budget_spend_match.service";
import { derive_budget_view_periods } from "../src/functions/domain/budgets/budget_view.service";
import type { PeriodInstanceType } from "../src/functions/domain/budgets";

const U = "detail_parity_user";
const ctx = { trace_id: "t", span_id: "s" } as never;
const D = (d: number) => Date.UTC(2032, 9, d);
const CARD = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

async function seed() {
  const batch = db.batch();
  const budget = (id: string, name: string, period: string, ee: boolean, cats: string[]) =>
    batch.set(db.collection("budgets").doc(id), {
      id, name, userId: U, ownerId: U, createdBy: U, groupIds: [], isActive: true,
      isSystemEverythingElse: ee, period, budgetType: "recurring", amount: ee ? 0 : 200,
      categoryIds: cats, startDate: Timestamp.fromMillis(Date.UTC(2030, 0, 1)), createdAt: Timestamp.fromMillis(Date.UTC(2030, 0, 1)),
    });
  budget("dp_ee", "Everything Else", "monthly", true, []);
  budget("dp_real", "Gifts", "monthly", false, ["gifts"]);
  budget("dp_ee_w", "Everything Else (Weekly)", "weekly", true, []);
  budget("dp_ee_b", "Everything Else (Bi-Monthly)", "bi_monthly", true, []);
  const bill = (id: string, name: string, stream: string[], removal?: number) =>
    batch.set(db.collection("outflows").doc(id), {
      id, ownerId: U, userId: U, createdBy: U, groupIds: [], isActive: true, isHidden: false,
      description: name, merchantName: name, frequency: "monthly", accountId: "chk",
      averageAmount: 50, lastAmount: 50, firstDate: Timestamp.fromMillis(Date.UTC(2031, 0, 1)),
      lastDate: Timestamp.fromMillis(D(1)), transactionIds: stream,
      ...(removal ? { removalIntervals: [{ fromMs: removal, toMs: null, mode: "going_forward" }] } : {}),
    });
  bill("dp_doordash", "DoorDash", [], D(1));
  bill("dp_gym", "Gym", ["p_gym"]);
  bill("dp_rent", "Rent", []);
  const txn = (id: string, name: string, amount: number, day: number, type: string, account: string, code: string, split: Record<string, unknown> = {}) =>
    batch.set(db.collection("transactions").doc(id), {
      transactionId: `p_${id.replace("dp_", "")}`, userId: U, ownerId: U, groupIds: [], isActive: true, isDeleted: false,
      name, description: name, merchantName: name, amount, type, accountId: account, source: "plaid", currency: "USD",
      transactionDate: Timestamp.fromMillis(D(day)), isPending: false, plaidDetailedCategory: code,
      splits: [{ splitId: `${id}_s`, amount, plaidDetailedCategory: code, outflowId: null, inflowId: null, ...split }],
    });
  txn("dp_coffee", "Coffee", 10, 2, "expense", "chk", "OTHER_EXPENSE");
  txn("dp_return", "Return", 3, 3, "income", "chk", "OTHER_EXPENSE");
  txn("dp_dash", "DoorDash", 17.03, 15, "expense", "visa", "OTHER_EXPENSE", { outflowId: "dp_doordash" });
  txn("dp_gym", "Gym", 50, 4, "expense", "chk", "OTHER_EXPENSE");
  txn("dp_rent", "Rent", 900, 1, "expense", "chk", "OTHER_EXPENSE", { outflowId: "dp_rent" });
  txn("dp_cp_o", "CAPITAL ONE PMT", 772, 9, "expense", "chk", CARD);
  txn("dp_cp_i", "CAPITAL ONE AUTOPAY", 772, 9, "income", "visa", CARD);
  txn("dp_ig_o", "BIG PMT", 200, 20, "expense", "chk", CARD, { spendStatus: "ignored", isIgnored: true });
  txn("dp_ig_i", "BIG PMT THANKS", 200, 21, "income", "visa", CARD);
  txn("dp_amz", "AMAZON CARD PMT", 300, 13, "expense", "chk", CARD);
  txn("dp_leg_q", "LEG Q", 500, 21, "expense", "chk", CARD);
  txn("dp_leg_p", "LEG P", 500, 24, "income", "visa", CARD);
  txn("dp_leg_x", "LEG X", 500, 28, "expense", "chk", CARD);
  txn("dp_gift", "Gift", 25, 6, "expense", "chk", "OTHER_EXPENSE", { budgetAssignmentSource: "manual", budgetId: "dp_real" });
  await batch.commit();
}

function periodDoc(id: string, type: string, start: number, end: number) {
  return db.collection("source_periods").doc(id).set({
    id, periodId: id, type, startDate: Timestamp.fromMillis(start), endDate: Timestamp.fromMillis(end),
    year: 2032, index: 1,
  });
}

const signed = (r: { spend_status: string; amount: number; card: { type?: string } }) =>
  r.spend_status === "ignored" ? 0 : r.card.type === "income" ? -Math.abs(r.amount) : Math.abs(r.amount);

async function pageVsDetail(cadence: PeriodInstanceType, budget_id: string, start: number, end: number) {
  const raw = await load_period_derivation_raw(ctx, U, cadence, [{ start_ms: start, end_ms: end }]);
  const deps = shape_period_derivation_deps(raw, cadence, start, end);
  const b = deps.budgets.find((x) => x.id === budget_id)!;
  const ee = deps.monthly_ee_id ?? deps.any_ee_id;
  const owned = owned_splits_for_budget(budget_id, deps.real_budgets, ee, deps.splits_for_match, deps.ee_alias_ids);
  const page = derive_budget_view_periods(budget_id, deps.view_buckets, b.monthly_periods, owned)[0]?.spent ?? 0;
  const rows = await derive_budget_transactions_orchestrator(ctx, U, budget_id, start, end, true);
  const detail = Math.round(rows.reduce((a, r) => a + signed(r as never), 0) * 100) / 100;
  return { page, detail, rows };
}

describe("Budget Detail equals the period page", () => {
  beforeAll(async () => {
    await seed();
    await periodDoc("2032M10", "monthly", D(1), Date.UTC(2032, 9, 31, 23, 59, 59, 999));
    await periodDoc("2032BM10A", "bi_monthly", D(1), Date.UTC(2032, 9, 15, 23, 59, 59, 999));
    await periodDoc("2032W42", "weekly", D(10), Date.UTC(2032, 9, 16, 23, 59, 59, 999));
    await periodDoc("2032W44", "weekly", D(28), Date.UTC(2032, 10, 3, 23, 59, 59, 999));
  });

  it("monthly: the hand-computed total on both", async () => {
    const { page, detail, rows } = await pageVsDetail("monthly", "dp_ee", D(1), Date.UTC(2032, 9, 31, 23, 59, 59, 999));
    expect(page).toBeCloseTo(824.03, 2);
    expect(detail).toBeCloseTo(824.03, 2);
    const names = rows.map((r) => r.name);
    expect(names).toContain("DoorDash");
    expect(names).not.toContain("Gym");
    expect(names).not.toContain("Rent");
    expect(rows.find((r) => r.name === "CAPITAL ONE AUTOPAY")?.ignored_reason).toBe("transfer");
    expect(rows.find((r) => r.name === "AMAZON CARD PMT")?.spend_status).toBe("counted");
  });

  // Every lens shows the one Everything Else (the page's `canonical_ee_id`).
  it("bi-monthly and weekly: Detail equals the page", async () => {
    const bi = await pageVsDetail("bi_monthly", "dp_ee", D(1), Date.UTC(2032, 9, 15, 23, 59, 59, 999));
    expect(bi.detail).toBeCloseTo(bi.page, 2);
    const wk = await pageVsDetail("weekly", "dp_ee", D(10), Date.UTC(2032, 9, 16, 23, 59, 59, 999));
    expect(wk.detail).toBeCloseTo(wk.page, 2);
    expect(wk.page).toBeCloseTo(317.03, 2); // Oct 13 Amazon 300 + Oct 15 DoorDash 17.03
  });

  it("a week with competing card-payment legs: Detail pairs as that view does", async () => {
    const wk = await pageVsDetail("weekly", "dp_ee", D(28), Date.UTC(2032, 10, 3, 23, 59, 59, 999));
    expect(wk.page).toBeCloseTo(0, 2);
    expect(wk.detail).toBeCloseTo(0, 2);
  });

  it("a real budget: Detail equals the page", async () => {
    const m = await pageVsDetail("monthly", "dp_real", D(1), Date.UTC(2032, 9, 31, 23, 59, 59, 999));
    expect(m.page).toBeCloseTo(25, 2);
    expect(m.detail).toBeCloseTo(25, 2);
  });
});
