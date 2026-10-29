/**
 * Emulator — go-forward tracking (Convert-To-Recurring test plan F, a user priority).
 * Every way a bill comes to exist must link its NEXT payment through the real sync / assignment
 * path: linked, the period paid, out of budgets. (F2/F3/F4/F8/F9/F11 live in the planner, answer,
 * same-bill and it-ended suites.) Here:
 *   F1  old Plaid record                     → linked exactly as today
 *   F12 pending, then posted                 → linked while pending ("Pending"), stays linked posted
 *   F14 bill on a group-shared account       → linked; paid in the group view (owner AND member)
 *   G8  Still a bill? on that shared account → the owner's item only; group view keeps the bill
 *   F15 a manual pin on an older payment     → the new payment links; the old pin untouched
 *   F17 flag turned off after tracking (D16) → still linked; v2 behavior continues
 *   F18 the same payment delivered twice     → one transaction, one link, paid once
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern goForwardTracking"
 */
import * as admin from "firebase-admin";
import {
  FAKE_CLOCK, OCT, clearFlagFor, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths,
} from "./helpers/captureHarness";
import { NOW_MS } from "./helpers/captureScenario";

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
let transaction_repo: any;
let sharing: any;
let account_repo: any;
let derive_period: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  ({ derive_period_orchestrator: derive_period } = require("../src/functions/orchestrators/periods/derive_period.orchestrator"));
  ({ transaction_repo } = require("../src/functions/repositories/transaction.repo"));
  ({ account_repo } = require("../src/functions/repositories/account.repo"));
  sharing = {
    ...require("../src/functions/orchestrators/sharing/connect.orchestrator"),
    ...require("../src/functions/orchestrators/sharing/connections.orchestrator"),
    ...require("../src/functions/orchestrators/sharing/groups.orchestrator"),
  };
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const octx = <T>(user_id: string, input: T) => ({ ...ctx(), user_id, input, idempotency_key: `k_${Math.random()}` });
const spotify = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: "chk", amount: 15.49, days_ago, name: "SPOTIFY USA", merchant: "Spotify",
    primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" }),
  ...o,
});
const SPOT_KEYS = ["spot0", "spot1", "spot2", "spot3", "spot4"];

describe("go-forward tracking (emulator)", () => {
  it("F1: an OLD Plaid record links its next payment exactly as today", async () => {
    const h = await makeHarness(db, "qzf1", mocks, { flag: false });
    await h.sync("link");
    h.postTxns([spotify(h.ids, "f1new", 0)]);
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { transaction_keys: [...SPOT_KEYS, "f1new"] } }));
    await h.sync("f1");
    expect((await h.txn("f1new"))?.splits[0].outflowId).toBe(h.ids.streams.SPOT);
    expect((await db.collection("outflows").doc(h.ids.streams.SPOT).get()).data()?.captureRulesVersion).toBeUndefined();
  }, 120000);

  it("F12: pending → linked as \"Pending\"; posted → stays linked (split inheritance)", async () => {
    const h = await makeHarness(db, "qzf12", mocks, { flag: true });
    await h.sync("link");
    const SPOT = h.ids.streams.SPOT;
    jest.setSystemTime(Date.parse("2037-11-05T12:00:00Z"));
    const NOV = { start: Date.UTC(2037, 10, 1), end: Date.UTC(2037, 11, 1) - 1 };
    const at = Date.parse("2037-11-04T12:00:00Z");
    const pend = { ...plaidTxn(h.ids, { key: "f12p", account: "chk", amount: 15.49, days_ago: 0, name: "SPOTIFY USA",
      merchant: "Spotify", primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" }, at), pending: true };
    h.postTxns([pend]);
    await h.sync("pending");
    expect((await h.txn("f12p"))?.splits[0].outflowId).toBe(SPOT);
    const pending_bill = await h.bill(NOV, SPOT);
    expect(paidTotal(pending_bill)).toBe(15.49);
    // Posted: Plaid removes the pending id and adds the posted one pointing at it.
    const posted = { ...plaidTxn(h.ids, { key: "f12posted", account: "chk", amount: 15.49, days_ago: 0, name: "SPOTIFY USA",
      merchant: "Spotify", primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" }, at), pending_transaction_id: h.ids.txn("f12p") };
    h.removeTxns([h.ids.txn("f12p")]);
    h.postTxns([posted]);
    await h.sync("posted");
    expect((await h.txn("f12posted"))?.splits[0].outflowId).toBe(SPOT);
    expect(paidTotal(await h.bill(NOV, SPOT))).toBe(15.49); // paid once, not twice
    jest.setSystemTime(NOW_MS);
  }, 180000);

  it("F14 + G8: group-shared account — linked and paid in the group view; Still a bill? owner-only, bill kept", async () => {
    const h = await makeHarness(db, "qzf14", mocks, { flag: true });
    const owner = h.ids.userId;
    const member = `${h.ids.tag}_member`;
    await db.collection("users").doc(member).set({ email: `${member}@x.com` });
    const a = (await sharing.get_my_connect_code_orchestrator(octx(owner, { refresh: true }))).code;
    const b = (await sharing.get_my_connect_code_orchestrator(octx(member, { refresh: true }))).code;
    await sharing.enter_connect_code_orchestrator(octx(owner, { code: b }));
    await sharing.enter_connect_code_orchestrator(octx(member, { code: a }));
    const group_id = (await sharing.create_group_orchestrator(octx(owner, { name: "Home", invitee_ids: [member] }))).group_id;
    const req = (await sharing.get_sharing_overview_orchestrator(octx(member, {}))).requests[0];
    await sharing.respond_to_request_orchestrator(octx(member, { request_id: req.id, accept: true }));
    await account_repo.set_placement(ctx(), h.ids.chk, { group_id, shared_from_ms: null, shared_by: owner, shared_at_ms: NOW_MS }, owner);
    await h.sync("link");
    const SPOT = h.ids.streams.SPOT;
    const group_oct = (uid: string) => derive_period(ctx(), uid, {
      view_cadence: "monthly", window_start_ms: OCT.start, window_end_ms: OCT.end, force: true, scope: { kind: "group", group_id },
    });
    // F14: a new payment on the shared account links; paid in the group view for both members.
    h.postTxns([spotify(h.ids, "f14new", 0)]);
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { transaction_keys: [...SPOT_KEYS, "f14new"] } }));
    await h.sync("f14");
    expect((await h.txn("f14new"))?.splits[0].outflowId).toBe(SPOT);
    for (const uid of [owner, member]) {
      const bill = (await group_oct(uid)).bills.find((x: { recurring_id: string }) => x.recurring_id === SPOT);
      // The October occurrence is paid (one occurrence of a monthly bill → 15.49), for both members.
      expect([uid, paidTotal(bill), bill?.groups?.[0]?.status]).toEqual([uid, 15.49, "paid"]);
    }
    // G8: Plaid turns it off → the owner's question only; the group view keeps the bill (D10).
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false, transaction_keys: [...SPOT_KEYS, "f14new"] } }));
    await h.sync("off");
    const q = (await db.collection("recurring_review_items").where("kind", "==", "still_a_bill").where("recordId", "==", SPOT).get()).docs.map((d) => d.data());
    expect(q.map((i) => i.userId)).toEqual([owner]);
    expect((await db.collection("recurring_review_items").where("userId", "==", member).get()).size).toBe(0);
    for (const uid of [owner, member]) {
      expect((await group_oct(uid)).bills.some((x: { recurring_id: string }) => x.recurring_id === SPOT)).toBe(true);
    }
  }, 240000);

  it("F15: a manual pin on an older payment stays; the new payment links", async () => {
    const h = await makeHarness(db, "qzf15", mocks, { flag: true });
    await h.sync("link");
    const SPOT = h.ids.streams.SPOT;
    const groc = await h.txn("groc3");
    await transaction_repo.pin_split_to_outflow(ctx(), `plaid_${h.ids.txn("groc3")}`, groc.splits[0].splitId, SPOT, h.ids.userId);
    h.postTxns([spotify(h.ids, "f15new", 0)]);
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { transaction_keys: [...SPOT_KEYS, "f15new"] } }));
    await h.sync("f15");
    expect((await h.txn("f15new"))?.splits[0].outflowId).toBe(SPOT);
    const pinned = (await h.txn("groc3"))!.splits[0];
    expect([pinned.outflowId, pinned.outflowAssignmentSource]).toEqual([SPOT, "manual"]);
  }, 180000);

  it("F17: flag turned off after tracking → still linked; v2 behavior continues (D16)", async () => {
    const h = await makeHarness(db, "qzf17", mocks, { flag: true });
    await h.sync("link");
    await clearFlagFor(db, h.ids.userId);
    const SPOT = h.ids.streams.SPOT;
    h.postTxns([spotify(h.ids, "f17new", 0)]);
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { transaction_keys: [...SPOT_KEYS, "f17new"] } }));
    await h.sync("f17");
    expect((await h.txn("f17new"))?.splits[0].outflowId).toBe(SPOT);
    // v2 keeps v2 behavior: Plaid turning it off still keeps it active + asks.
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { is_active: false, transaction_keys: [...SPOT_KEYS, "f17new"] } }));
    await h.sync("off");
    const o = (await db.collection("outflows").doc(SPOT).get()).data()!;
    expect([o.isActive, o.plaidIsActive, o.captureRulesVersion]).toEqual([true, false, 2]);
    expect((await db.collection("recurring_review_items").where("userId", "==", h.ids.userId).where("kind", "==", "still_a_bill").get()).size).toBe(1);
    // …but new streams are no longer stamped (flag gates stamping only).
    h.ids.streams.NEWB = `${h.ids.tag}_S_NEWB`;
    const rec = scenarioRecurring(h.ids, { SPOT: { is_active: false, transaction_keys: [...SPOT_KEYS, "f17new"] } });
    rec.outflow_streams.push({ ...rec.outflow_streams[0], stream_id: h.ids.streams.NEWB, merchant_name: "Newco", description: "NEWCO", transaction_ids: [] });
    h.setRecurring(rec);
    await h.sync("new_stream");
    expect((await db.collection("outflows").doc(h.ids.streams.NEWB).get()).data()?.captureRulesVersion).toBeUndefined();
  }, 180000);

  it("F18: the same payment delivered twice → one transaction, one link, paid once", async () => {
    const h = await makeHarness(db, "qzf18", mocks, { flag: true });
    await h.sync("link");
    const SPOT = h.ids.streams.SPOT;
    const t = spotify(h.ids, "f18", 0);
    h.setRecurring(scenarioRecurring(h.ids, { SPOT: { transaction_keys: [...SPOT_KEYS, "f18"] } }));
    h.postTxns([t]);
    await h.sync("first");
    h.postTxns([t]); // Plaid re-sends / recycles the same transaction id
    await h.sync("again");
    const docs = await db.collection("transactions").where("transactionId", "==", h.ids.txn("f18")).get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0].data().splits[0].outflowId).toBe(SPOT);
    // Never doubled: the October occurrence is paid once.
    expect(paidTotal(await h.bill(OCT, SPOT))).toBe(15.49);
  }, 180000);
});
