/**
 * Emulator — group views under the capture rules (review round 3).
 *
 *   - Top-25 #18: the owner's HELD-OUT payment (a new, unsure Sunbit stream next to an OLD Sunbit
 *     bill) on a group-shared account — in the group view, monthly, weekly and twice-a-month, for
 *     the owner AND the member: it is budget spend (Everything Else), never a payment of the old
 *     bill; the member has no review tile at all.
 *   - Top-25 #19 (G6): the owner unshares the account after a v2 bill was tracked → the bill leaves
 *     the group view, stays in the owner's own view; review items are untouched.
 */
import * as admin from "firebase-admin";
import { FAKE_CLOCK, OCT, makeHarness, plaidTxn, scenarioRecurring, seedMonths, setFlag } from "./helpers/captureHarness";
import { NOW_MS, plaidStream } from "./helpers/captureScenario";
import { synthetic, withSyntheticPeriods } from "./helpers/syntheticPeriods";
import { startCounting } from "./helpers/firestoreCounter";

const mockSync = jest.fn();
const mockRecurring = jest.fn();
jest.mock("../src/functions/integrations/plaid", () => {
  const actual = jest.requireActual("../src/functions/integrations/plaid");
  return {
    ...actual,
    sync_transactions: (...a: unknown[]) => mockSync(...a),
    fetch_recurring_transactions: (...a: unknown[]) => mockRecurring(...a),
    fetch_plaid_accounts: async () => ({ accounts: [], item_id: "x", request_id: "r" }),
    safe_fetch_liabilities: async () => null,
  };
});
jest.mock("../src/utils/encryption", () => {
  const actual = jest.requireActual("../src/utils/encryption");
  return { ...actual, decryptAccessToken: () => "decrypted-token" };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let sharing: any;
let account_repo: any;
let derive_period: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  ({ derive_period_orchestrator: derive_period } = require("../src/functions/orchestrators/periods/derive_period.orchestrator"));
  ({ account_repo } = require("../src/functions/repositories/account.repo"));
  sharing = {
    ...require("../src/functions/orchestrators/sharing/connect.orchestrator"),
    ...require("../src/functions/orchestrators/sharing/connections.orchestrator"),
    ...require("../src/functions/orchestrators/sharing/groups.orchestrator"),
    ...require("../src/functions/orchestrators/sharing/placement.orchestrator"),
  };
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const octx = <T>(user_id: string, input: T) => ({ ...ctx(), user_id, input, idempotency_key: `k_${Math.random()}` });
const SYN = synthetic(Date.UTC(2037, 8, 27), Date.UTC(2037, 10, 8), "GV");

async function groupWith(h: Awaited<ReturnType<typeof makeHarness>>, n_members = 1) {
  const owner = h.ids.userId;
  const members = Array.from({ length: n_members }, (_, i) => `${h.ids.tag}_member${i ? i + 1 : ""}`);
  for (const m of members) {
    const a = (await sharing.get_my_connect_code_orchestrator(octx(owner, { refresh: true }))).code;
    await db.collection("users").doc(m).set({ email: `${m}@x.com` });
    const b = (await sharing.get_my_connect_code_orchestrator(octx(m, { refresh: true }))).code;
    await sharing.enter_connect_code_orchestrator(octx(owner, { code: b }));
    await sharing.enter_connect_code_orchestrator(octx(m, { code: a }));
  }
  const group_id = (await sharing.create_group_orchestrator(octx(owner, { name: "Home", invitee_ids: members }))).group_id;
  for (const m of members) {
    const req = (await sharing.get_sharing_overview_orchestrator(octx(m, {}))).requests[0];
    await sharing.respond_to_request_orchestrator(octx(m, { request_id: req.id, accept: true }));
  }
  await account_repo.set_placement(ctx(), h.ids.chk, { group_id, shared_from_ms: null, shared_by: owner, shared_at_ms: NOW_MS }, owner);
  return { owner, member: members[0], members, group_id };
}

const view = (uid: string, cadence: string, scope: any): Promise<any> =>
  withSyntheticPeriods(SYN, () => derive_period(ctx(), uid, {
    view_cadence: cadence, window_start_ms: OCT.start, window_end_ms: OCT.end, force: true, ...(scope ? { scope } : {}),
  }));
const eeSpent = (r: any) => Math.round(r.budgets.filter((b: any) => b.is_everything_else)
  .reduce((s: number, b: any) => s + b.periods.reduce((x: number, p: any) => x + (p.spent ?? 0), 0), 0) * 100) / 100;
const linkedTo = (r: any, txn_doc: string) =>
  r.bills.filter((b: any) => b.groups.some((g: any) => g.occurrences.some((o: any) => o.transaction_id === txn_doc))).map((b: any) => b.recurring_id);

describe("group views under the capture rules (emulator)", () => {
  it("#18 the owner's held-out payment: group budget spend in all 3 cadences, never the old bill; no member tile", async () => {
    const h = await makeHarness(db, "qzgv18", mocks, { flag: false });
    const { owner, member, group_id } = await groupWith(h);
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } }));
    await h.sync("link");
    const OLD = h.ids.streams.SUNBIT;
    expect((await db.collection("outflows").doc(OLD).get()).data()?.captureRulesVersion).toBeUndefined();
    await setFlag(db, [owner]);
    h.ids.streams.SUNBIT2 = `${h.ids.tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } });
    rec.outflow_streams.push(plaidStream(h.ids, "SUNBIT2", {
      account: "chk", keys: ["sunbitnew"], amount: 50, description: "SUNBIT", merchant: "Sunbit", primary: "LOAN_PAYMENTS",
      detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "MONTHLY", status: "EARLY_DETECTION", is_active: true,
      first_days_ago: 0, last_days_ago: 0, next_days: 30,
    }));
    h.setRecurring(rec);
    const scope = { kind: "group", group_id };
    const before: Record<string, number> = {};
    for (const uid of [owner, member]) for (const c of ["monthly", "weekly", "bi_monthly"]) before[`${uid}:${c}`] = eeSpent(await view(uid, c, scope));
    h.postTxns([plaidTxn(h.ids, { key: "sunbitnew", account: "chk", amount: 50, days_ago: 0, name: "SUNBIT", merchant: "Sunbit",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" })]);
    await h.sync("new_stream");
    expect((await h.txn("sunbitnew"))?.splits[0].outflowId ?? null).toBeNull(); // held out: no link stored
    const doc = `plaid_${h.ids.txn("sunbitnew")}`;
    for (const uid of [owner, member]) {
      for (const c of ["monthly", "weekly", "bi_monthly"]) {
        const r = await view(uid, c, scope);
        expect({ uid: uid === owner ? "owner" : "member", c, linked: linkedTo(r, doc), ee: Math.round((eeSpent(r) - before[`${uid}:${c}`]) * 100) / 100 })
          .toEqual({ uid: uid === owner ? "owner" : "member", c, linked: [], ee: 50 });
        expect(r.bills.some((b: any) => b.recurring_id === OLD)).toBe(true); // the old bill is still there (shared account)
      }
    }
    // The tile is the owner's alone.
    expect((await db.collection("recurring_review_items").where("userId", "==", member).get()).size).toBe(0);
    const owner_items = (await db.collection("recurring_review_items").where("userId", "==", owner).get()).docs.map((d) => d.data());
    expect(owner_items.some((i) => i.vendorKey === "sunbit" && i.status === "open")).toBe(true);
  }, 300000);

  it("#19 G6: unsharing after a v2 bill was tracked → out of the group view, kept in the owner's; items untouched", async () => {
    const h = await makeHarness(db, "qzgv19", mocks, { flag: true });
    const { owner, member, group_id } = await groupWith(h);
    await h.sync("link");
    const SPOT = h.ids.streams.SPOT;
    expect((await db.collection("outflows").doc(SPOT).get()).data()?.captureRulesVersion).toBe(2);
    const scope = { kind: "group", group_id };
    for (const uid of [owner, member]) expect((await view(uid, "monthly", scope)).bills.some((b: any) => b.recurring_id === SPOT)).toBe(true);
    const items_before = (await db.collection("recurring_review_items").where("userId", "==", owner).get()).docs
      .map((d) => d.data()).sort((a, b) => (a.id < b.id ? -1 : 1));
    const r = await sharing.unshare_account_orchestrator(octx(owner, { account_id: h.ids.chk }));
    expect(r).toBeDefined();
    for (const uid of [owner, member]) {
      for (const c of ["monthly", "weekly", "bi_monthly"]) {
        expect({ uid, c, in_group: (await view(uid, c, scope)).bills.some((b: any) => b.recurring_id === SPOT) }).toEqual({ uid, c, in_group: false });
      }
    }
    expect((await view(owner, "monthly", null)).bills.some((b: any) => b.recurring_id === SPOT)).toBe(true);
    const items_after = (await db.collection("recurring_review_items").where("userId", "==", owner).get()).docs
      .map((d) => d.data()).sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(items_after).toEqual(items_before);
    expect((await db.collection("recurring_review_items").where("userId", "==", member).get()).size).toBe(0);
  }, 300000);

  it("round 4 test 3: a COLD flag cache + a 3-member group derive → exactly 1 _feature_flags read (single-flight)", async () => {
    const h = await makeHarness(db, "qzgvff", mocks, { flag: false });
    const { owner, members, group_id } = await groupWith(h, 2);
    expect(members).toHaveLength(2); // + the owner = 3 members
    await h.sync("link");
    const scope = { kind: "group", group_id };
    const coll = process.env.FEATURE_FLAGS_COLLECTION_OVERRIDE ?? "_feature_flags";
    const ff = require("../src/functions/infrastructure/feature_flags");
    ff.invalidate_flag_cache();
    const cold = startCounting();
    const r = await view(owner, "monthly", scope);
    const c = cold.stop();
    expect(r.bills.length).toBeGreaterThan(0);
    expect(c.reads_by[coll] ?? 0).toBe(1);
    const warm = startCounting();
    await view(members[1], "monthly", scope);
    expect(warm.stop().reads_by[coll] ?? 0).toBe(0);
  }, 300000);
});
