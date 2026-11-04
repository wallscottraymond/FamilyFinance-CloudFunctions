/**
 * A Fund in a group, against the same Fund in Me: everyone in the group sees the same running total,
 * built from every member's assigned transactions on shared accounts, across months. Worked by hand.
 *
 * Group fund: $300, Oct-Dec 2032. Alex $100 on the joint account in Oct, Sam $50 on a shared card in
 * Nov. Alex also assigns $999 from a private account: out of this view, so it doesn't count.
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
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
import { account_repo } from "../src/functions/repositories/account.repo";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ALEX = `fa_${RUN}`;
const SAM = `fs_${RUN}`;
const id = (s: string) => `${s}_${RUN}`;
const octx = <T>(user_id: string, input: T) => ({
  trace_id: `t_${Math.random()}`, span_id: "s", user_id, input, idempotency_key: `k_${Math.random()}`,
});
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const month = (m: number) => ({ start: Date.UTC(2032, m, 1), end: Date.UTC(2032, m + 1, 0, 23, 59, 59, 999) });

async function account(doc_id: string, user: string, subtype: string) {
  await db.collection("accounts").doc(doc_id).set({
    id: doc_id, userId: user, groupIds: [], isActive: true, isDeleted: false, createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(), accountId: `p_${doc_id}`, itemId: `item_${user}`, name: doc_id, accountName: doc_id,
    mask: "0000", accountType: subtype === "credit card" ? "credit" : "depository", accountSubtype: subtype,
    currentBalance: 0, institutionId: "ins", institutionName: "Bank",
  });
}

let group_id = "";
let fund_id = "";
let me_fund_id = "";

async function pin(key: string, user: string, acct: string, amount: number, ms: number, budget_id: string) {
  await db.collection("transactions").doc(id(key)).set({
    transactionId: `pt_${id(key)}`, userId: user, ownerId: user, accountId: `p_${acct}`, isActive: true, isPending: false,
    transactionDate: Timestamp.fromMillis(ms), type: "expense", name: key, merchantName: key,
    plaidDetailedCategory: "GENERAL_MERCHANDISE_OTHER", splitBudgetIds: [budget_id],
    splits: [{
      splitId: `s_${key}`, amount, plaidPrimaryCategory: "GENERAL_MERCHANDISE",
      plaidDetailedCategory: "GENERAL_MERCHANDISE_OTHER", internalDetailedCategory: null,
      budgetId: budget_id, budgetAssignmentSource: "manual", outflowId: null, inflowId: null,
    }],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

const fund_input = (view_group_id?: string) => ({
  name: "Christmas", amount: 300, category_ids: [], is_manual: true, is_fund: true, period: "monthly",
  budget_type: "limited", start_date: "2032-10-01T00:00:00.000Z", budget_end_date: "2032-12-31T00:00:00.000Z",
  alert_threshold: 80, is_shared: false, is_ongoing: false, view_group_id,
});

async function view(user: string, m: number, budget_id: string, group?: string) {
  const { start, end } = month(m);
  const r = await derive_period_orchestrator(t(), user, {
    view_cadence: "monthly", window_start_ms: start, window_end_ms: end, force: true,
    scope: group ? { kind: "group", group_id: group } : undefined,
  });
  return r.budgets.find((b) => b.budget_id === budget_id);
}

beforeAll(async () => {
  for (const u of [ALEX, SAM]) {
    await db.collection("users").doc(u).set({ email: `${u}@x.com`, preferences: { currency: "USD" } });
  }
  for (const m of [9, 10, 11]) {
    const { start, end } = month(m);
    const pid = `2032M${m + 1}`;
    await db.collection("source_periods").doc(pid).set({
      periodId: pid, type: "monthly", year: 2032,
      startDate: Timestamp.fromMillis(start), endDate: Timestamp.fromMillis(end),
    });
  }
  await account(id("chk_a"), ALEX, "checking");
  await account(id("jc"), ALEX, "checking");
  await account(id("amex_s"), SAM, "credit card");
  await createEverythingElseBudget(db, ALEX);
  await createEverythingElseBudget(db, SAM);
  const a = (await get_my_connect_code_orchestrator(octx(ALEX, { refresh: true }))).code;
  const s = (await get_my_connect_code_orchestrator(octx(SAM, { refresh: true }))).code;
  await enter_connect_code_orchestrator(octx(ALEX, { code: s }));
  await enter_connect_code_orchestrator(octx(SAM, { code: a }));
  group_id = (await create_group_orchestrator(octx(ALEX, { name: "Home", invitee_ids: [SAM] }))).group_id!;
  const req = (await get_sharing_overview_orchestrator(octx(SAM, {} as Record<string, never>))).requests[0];
  await respond_to_request_orchestrator(octx(SAM, { request_id: req.id, accept: true }));
  const shared_at = Date.UTC(2032, 0, 1);
  await account_repo.set_placement(t(), id("jc"), { group_id, shared_from_ms: null, shared_by: ALEX, shared_at_ms: shared_at }, ALEX);
  await account_repo.set_placement(t(), id("amex_s"), { group_id, shared_from_ms: null, shared_by: SAM, shared_at_ms: shared_at }, SAM);

  fund_id = (await create_budget_orchestrator(t(), ALEX, id("group_fund"), fund_input(group_id) as never)).budget_id;
  me_fund_id = (await create_budget_orchestrator(t(), ALEX, id("me_fund"), fund_input() as never)).budget_id;

  await pin("joint_oct", ALEX, id("jc"), 100, Date.UTC(2032, 9, 10), fund_id);
  await pin("amex_nov", SAM, id("amex_s"), 50, Date.UTC(2032, 10, 10), fund_id);
  await pin("private_nov", ALEX, id("chk_a"), 999, Date.UTC(2032, 10, 11), fund_id);
  await pin("me_oct", ALEX, id("chk_a"), 40, Date.UTC(2032, 9, 12), me_fund_id);
});

describe("funds in a group and in Me", () => {
  it("a group fund runs down from every member's transactions, the same for both people", async () => {
    for (const user of [ALEX, SAM]) {
      const oct = (await view(user, 9, fund_id, group_id))!;
      expect(oct.is_fund).toBe(true);
      expect(oct.periods[0]).toMatchObject({ allocated_amount: 100, spent: 100, remaining: 200, fund_spent_to_date: 100 });
      const nov = (await view(user, 10, fund_id, group_id))!.periods[0];
      expect(nov).toMatchObject({ allocated_amount: 100, spent: 50, remaining: 150, fund_spent_to_date: 150 });
      const dec = (await view(user, 11, fund_id, group_id))!.periods[0];
      expect(dec).toMatchObject({ spent: 0, remaining: 150, fund_spent_to_date: 150 });
    }
  });

  it("a transaction from an account outside the group doesn't count in the group's fund", async () => {
    const dec = (await view(ALEX, 11, fund_id, group_id))!.periods[0];
    expect(dec.fund_spent_to_date).toBe(150);
  });

  it("a Me fund runs down in Me, and neither view shows the other's fund", async () => {
    const nov = (await view(ALEX, 10, me_fund_id))!.periods[0];
    expect(nov).toMatchObject({ allocated_amount: 100, spent: 0, remaining: 260, fund_spent_to_date: 40 });
    expect(await view(ALEX, 10, fund_id)).toBeUndefined();
    expect(await view(ALEX, 10, me_fund_id, group_id)).toBeUndefined();
  });

  it("a group's fund only takes its share from the group's Everything Else, and a Me fund from Me's", async () => {
    const { start, end } = month(10);
    const derive = (group?: string) => derive_period_orchestrator(t(), ALEX, {
      view_cadence: "monthly", window_start_ms: start, window_end_ms: end, force: true,
      scope: group ? { kind: "group", group_id: group } : undefined,
    });
    const ee_limit = (r: Awaited<ReturnType<typeof derive>>) =>
      r.budgets.find((b) => b.is_everything_else)!.periods[0].allocated_amount;
    expect(ee_limit(await derive(group_id))).toBe(-100);
    expect(ee_limit(await derive())).toBe(-100);
  });
});
