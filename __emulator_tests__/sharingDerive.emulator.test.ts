/**
 * Emulator Integration Tests — Account-Rooted-Sharing Phase 3 (scoped numbers)
 *
 * A real two-person household, numbers computed BY HAND (Oct 2031, far from other suites):
 *
 *   Alex: CHK-A (private)  paycheck +5,000 (Oct 1), sends 2,400 to JC (Oct 2)
 *         VISA-A (private) coffee 18.00 (Oct 6)
 *         JC (SHARED with The Walls, all history): rent 2,000 (Oct 1), Costco 412.00 (Oct 5),
 *            receives 2,400 (Oct 2) + 1,400 (Oct 3)
 *   Sam:  CHK-S (private)  paycheck +3,000 (Oct 1), sends 1,400 to JC (Oct 3)
 *         AMEX-S (SHARED from Oct 10): Target 30.00 (Oct 8, BEFORE share-from) and 64.20 (Oct 12)
 *   Group budget "Groceries" (FOOD_AND_DRINK_GROCERIES). Riley is not a member.
 *
 * Expected, 2031M10:
 *   The Walls: Groceries 476.20 (412 + 64.20) · EE 2,000 (rent) · Other income 3,800 (2,400 + 1,400)
 *   Alex Me:   EE 2,418 (coffee 18 + 2,400 sent out) · Other income 5,000
 *   Sam Me:    EE 1,430 (1,400 sent out + Target 30 before share-from) · Other income 3,000
 *   Conservation: 476.20 + 2,000 + 2,418 + 1,430 = 6,324.20
 *               = purchases 2,524.20 + money sent across views 3,800.
 *
 * Prereq: firebase emulators:exec --only firestore \
 *   "npx jest --selectProjects emulator --testPathPattern sharingDerive"
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
import { derive_period_range_orchestrator } from "../src/functions/orchestrators/periods/derive_period_range.orchestrator";
import { derive_budget_transactions_orchestrator } from "../src/functions/orchestrators/budgets/derive_budget_transactions.orchestrator";
import { derive_budget_view_orchestrator } from "../src/functions/orchestrators/budgets/derive_budget_view.orchestrator";
import { createEverythingElseBudget } from "../src/functions/budgets/utils/createEverythingElseBudget";
import { account_repo } from "../src/functions/repositories/account.repo";
import { bump_derive_version } from "../src/functions/repositories/derive_version.repo";
import { PermissionDeniedError } from "../src/functions/types";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ALEX = `alex_${RUN}`;
const SAM = `sam_${RUN}`;
const RILEY = `riley_${RUN}`;
const id = (s: string) => `${s}_${RUN}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const OCT = { start: Date.UTC(2031, 9, 1), end: Date.UTC(2031, 9, 31, 23, 59, 59, 999) };
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
let groceries_id = "";
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

  groceries_id = (await create_budget_orchestrator(t(), ALEX, require("crypto").randomUUID(), {
    name: "Groceries", amount: 600, category_ids: ["FOOD_AND_DRINK_GROCERIES"], period: "monthly" as never,
    budget_type: "recurring" as never, start_date: "2031-01-01T00:00:00.000Z", alert_threshold: 80,
    is_shared: false, is_ongoing: true, view_group_id: group_id,
  })).budget_id;

  await txn("a_pay", ALEX, id("chk_a"), 5000, "2031-10-01T12:00:00Z", "INCOME_WAGES");
  await txn("s_pay", SAM, id("chk_s"), 3000, "2031-10-01T12:00:00Z", "INCOME_WAGES");
  await txn("rent", ALEX, id("jc"), 2000, "2031-10-01T12:00:00Z", "RENT_AND_UTILITIES_RENT");
  await txn("a_out", ALEX, id("chk_a"), 2400, "2031-10-02T12:00:00Z", "TRANSFER_OUT_ACCOUNT_TRANSFER");
  await txn("a_in", ALEX, id("jc"), 2400, "2031-10-02T12:00:00Z", "TRANSFER_IN_ACCOUNT_TRANSFER");
  await txn("s_out", SAM, id("chk_s"), 1400, "2031-10-03T12:00:00Z", "TRANSFER_OUT_ACCOUNT_TRANSFER");
  await txn("s_in", ALEX, id("jc"), 1400, "2031-10-03T12:00:00Z", "TRANSFER_IN_ACCOUNT_TRANSFER");
  await txn("costco", ALEX, id("jc"), 412, "2031-10-05T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
  await txn("coffee", ALEX, id("visa_a"), 18, "2031-10-06T12:00:00Z", "FOOD_AND_DRINK_COFFEE");
  await txn("target_early", SAM, id("amex_s"), 30, "2031-10-08T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
  await txn("target", SAM, id("amex_s"), 64.2, "2031-10-12T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
});

describe("scoped numbers — two-person household (emulator)", () => {
  it("T-DV-03 The Walls: Groceries 476.20, EE 2,000, other income 3,800", async () => {
    const g = await oct(ALEX, scope());
    expect(named(g, "Groceries")).toBe(476.2);
    expect(ee(g)).toBe(2000);
    expect(other_income(g)).toBe(3800);
  });

  it("every member sees the SAME group numbers", async () => {
    const [a, s] = [await oct(ALEX, scope()), await oct(SAM, scope())];
    expect(JSON.stringify(s)).toBe(JSON.stringify(a));
  });

  it("T-DV-02 / T-ED-03 Alex Me: EE 2,418 (coffee + 2,400 sent out), income 5,000, no group budget", async () => {
    const m = await oct(ALEX);
    expect(ee(m)).toBe(2418);
    expect(other_income(m)).toBe(5000);
    expect(m.budgets.some((b) => b.name === "Groceries")).toBe(false);
  });

  it("T-DV-05 Sam Me: EE 1,430 (1,400 out + Target before share-from), income 3,000", async () => {
    const m = await oct(SAM);
    expect(ee(m)).toBe(1430);
    expect(other_income(m)).toBe(3000);
  });

  it("conservation: every dollar counted exactly once across the three views", async () => {
    const [g, a, s] = [await oct(ALEX, scope()), await oct(ALEX), await oct(SAM)];
    const all_spend = named(g, "Groceries") + ee(g) + ee(a) + ee(s);
    expect(Math.round(all_spend * 100) / 100).toBe(2524.2 + 3800);
    expect(other_income(g) + other_income(a) + other_income(s)).toBe(3800 + 5000 + 3000);
  });

  it("T-SR non-member can't derive the group (even with a warm cache)", async () => {
    await oct(ALEX, scope()); // warm
    await expect(
      derive_period_orchestrator(t(), RILEY, {
        view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end, scope: scope(),
      })
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("range derive (Home) matches the single-window derive for the group", async () => {
    const r = await derive_period_range_orchestrator(t(), SAM, {
      view_cadence: "monthly", force: true, scope: scope(),
      windows: [{ period_id: "2031M10", start_ms: OCT.start, end_ms: OCT.end }],
    });
    expect(JSON.stringify(r.windows[0].derive)).toBe(JSON.stringify(await oct(SAM, scope())));
  });

  it("budget detail (list + view) agrees with the period page for the group budget", async () => {
    const rows = await derive_budget_transactions_orchestrator(t(), SAM, groceries_id, OCT.start, OCT.end, true, scope());
    expect(rows.map((r) => r.amount).sort()).toEqual([412, 64.2].sort());
    const view = await derive_budget_view_orchestrator(t(), SAM, {
      budget_id: groceries_id, view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end,
    } as never);
    expect(view!.periods.reduce((s, p) => s + p.spent, 0)).toBe(476.2);
    expect(await derive_budget_view_orchestrator(t(), RILEY, {
      budget_id: groceries_id, view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end,
    } as never)).toBeNull();
  });

  it("no leak: Sam's Me lists never include Alex's joint-account transactions; list total = page", async () => {
    const sam_ee = (await db.collection("budgets").where("userId", "==", SAM)
      .where("isSystemEverythingElse", "==", true).get()).docs
      .find((d) => d.data().period === "monthly")!.id;
    const rows = await derive_budget_transactions_orchestrator(t(), SAM, sam_ee, OCT.start, OCT.end, true);
    const ids = rows.map((r) => r.transaction_id);
    for (const k of ["rent", "costco", "a_in", "s_in"]) expect(ids).not.toContain(id(k));
    const counted = rows.filter((r) => r.spend_status === "counted").reduce((s, r) => s + r.amount, 0);
    expect(Math.round(counted * 100) / 100).toBe(ee(await oct(SAM)));
  });

  it("bills, income and goals follow their account (JC → group; CHK-A → Alex's Me)", async () => {
    const recurring = async (coll: string, key: string, owner: string, account_doc: string, cat: string) => {
      await db.collection(coll).doc(id(key)).set({
        id: id(key), ownerId: owner, userId: owner, createdBy: owner, updatedBy: owner,
        isActive: true, isHidden: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        plaidItemId: `item_${owner}`, accountId: `p_${account_doc}`, lastAmount: 100, averageAmount: 100,
        currency: "USD", description: key, merchantName: key, payerName: key, userCustomName: null,
        frequency: "monthly", firstDate: ts("2031-01-15T00:00:00Z"), lastDate: ts("2031-09-15T00:00:00Z"),
        predictedNextDate: ts("2031-10-15T00:00:00Z"), plaidPrimaryCategory: cat.split("_")[0],
        plaidDetailedCategory: cat, internalPrimaryCategory: null, internalDetailedCategory: null,
        transactionIds: [], source: "plaid", streamId: id(key),
      });
    };
    await recurring("outflows", "internet", ALEX, id("jc"), "RENT_AND_UTILITIES_INTERNET_AND_CABLE");
    await recurring("outflows", "gym", ALEX, id("chk_a"), "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS");
    await recurring("inflows", "rebate", ALEX, id("jc"), "INCOME_OTHER_INCOME");
    await db.collection("goals").doc(id("vacation")).set({
      id: id("vacation"), userId: ALEX, ownerId: ALEX, createdBy: ALEX, groupIds: [], isActive: true,
      isPrivate: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      access: { ownerId: ALEX, createdBy: ALEX, groupIds: [], isPrivate: true },
      goalType: "savings", name: "Vacation", status: "active", linkedAccountId: id("jc"),
      homeCadence: "monthly", perPeriodAmount: 100, baselineBalance: 0, baselineCountsExisting: false,
      priorityRank: 1, drawsIncome: true,
    });
    await bump_derive_version(ALEX);
    const ids_of = (r: Awaited<ReturnType<typeof oct>>, k: "bills" | "income") => r[k].map((b) => b.recurring_id);
    const [g, me] = [await oct(SAM, scope()), await oct(ALEX)];
    expect(ids_of(g, "bills")).toContain(id("internet"));
    expect(ids_of(g, "bills")).not.toContain(id("gym"));
    expect(ids_of(me, "bills")).toContain(id("gym"));
    expect(ids_of(me, "bills")).not.toContain(id("internet"));
    expect(ids_of(g, "income")).toContain(id("rebate"));
    expect(ids_of(me, "income")).not.toContain(id("rebate"));
    const goal_names = async (u: string, sc?: Scope) => {
      const r = await derive_period_range_orchestrator(t(), u, {
        view_cadence: "monthly", force: true, scope: sc,
        windows: [{ period_id: "2031M10", start_ms: OCT.start, end_ms: OCT.end }],
      });
      return JSON.stringify(r.windows[0].goals ?? {});
    };
    expect(await goal_names(SAM, scope())).toContain(id("vacation"));
    expect(await goal_names(ALEX)).not.toContain(id("vacation"));
  });

  it("cache: a member's new purchase refreshes the group view (no force)", async () => {
    const before = await derive_period_orchestrator(t(), ALEX, {
      view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end, scope: scope(),
    });
    await txn("target2", SAM, id("amex_s"), 10, "2031-10-20T12:00:00Z", "FOOD_AND_DRINK_GROCERIES");
    await bump_derive_version(SAM); // what on_transaction_written / sync do
    const after = await derive_period_orchestrator(t(), ALEX, {
      view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end, scope: scope(),
    });
    expect(named(after, "Groceries")).toBe(Math.round((named(before, "Groceries") + 10) * 100) / 100);
  });

  it("T-DV-07 guard: if Sam stops being a member but his Amex placement lingers, the group drops it and Sam's Me gets it back", async () => {
    // Simulate a failed release: group doc no longer lists Sam; placement + mirror untouched.
    const g = db.collection("groups").doc(group_id);
    const data = (await g.get()).data()!;
    const members = { ...data.members };
    delete members[SAM];
    await g.update({ members, memberIds: data.memberIds.filter((m: string) => m !== SAM) });
    const grp = await oct(ALEX, scope());
    expect(named(grp, "Groceries")).toBe(412);
    const sam_me = await oct(SAM);
    // Amex is back in Sam's Me: 30 + 64.20 + 10 (target2). The 1,400 he sent to JC is now an
    // ordinary transfer: JC is no longer an account of a group he's in, so it isn't edge money.
    expect(ee(sam_me)).toBe(104.2);
    await expect(oct(SAM, scope())).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
