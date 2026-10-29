/**
 * Emulator — "It ended" (Convert-To-Recurring X4 / D22 / D23 / X20 / F9).
 *
 * A v2 Spotify bill (last paid Oct 5) is ended going forward:
 *   - past periods unchanged (Sep + Oct still paid), detail still opens, bill not turned inactive;
 *   - nothing expected from November; a November payment is NOT linked and counts in budgets (F9);
 *   - it shows in the Removed list (ending next month) and Restore brings it back;
 *   - a merged-away bill is kept out of the Removed list and can't be restored (no double count);
 *   - the monthly period extension honors the end (X20): new periods after it are inactive,
 *     in step with the derive; an old record's extension is untouched (D13).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern itEndedRestore"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { FAKE_CLOCK, NOV, OCT, SEP, makeHarness, paidTotal, plaidTxn, seedMonths } from "./helpers/captureHarness";
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
let manage: (ctx: any, uid: string, groups: string[], input: any, now: number, repo: any, kind: string) => Promise<any>;
let outflow_repo: any;
let list_suppressed: (ctx: any, uid: string, now: number) => Promise<any>;
let extendOutflowPeriodsFor: (db: any, doc: any, end: Date) => Promise<number>;
let reassign_user: (ctx: any, input: any) => Promise<any>;
let derive_recurring_view: (...a: any[]) => Promise<any>;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  require("../src/functions/orchestrators/periods/derive_period.orchestrator");
  ({ manage_recurring_removal_orchestrator: manage } = require("../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator"));
  ({ outflow_repo } = require("../src/functions/repositories/outflow.repo"));
  ({ list_suppressed_recurring_orchestrator: list_suppressed } = require("../src/functions/orchestrators/recurring/list_suppressed_recurring.orchestrator"));
  ({ extendOutflowPeriodsFor } = require("../src/functions/outflows/outflow_periods/scheduled/extendRecurringOutflowPeriods"));
  ({ reassign_user_orchestrator: reassign_user } = require("../src/functions/orchestrators/transactions/reassign_user.orchestrator"));
  ({ derive_recurring_view_orchestrator: derive_recurring_view } = require("../src/functions/orchestrators/recurring/derive_recurring_view.orchestrator"));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });

describe("It ended → going-forward end (emulator)", () => {
  it("past intact, nothing after, F9, Removed list + Restore, merged blocked, extension in step", async () => {
    const h = await makeHarness(db, "qzend2", { mockSync, mockRecurring }, { flag: true });
    await h.sync("link");
    const SPOT = h.ids.streams.SPOT;
    const uid = h.ids.userId;
    expect(paidTotal(await h.bill(SEP, SPOT))).toBe(15.49);
    expect(paidTotal(await h.bill(OCT, SPOT))).toBe(15.49);
    expect((await h.bill(NOV, SPOT))?.groups.length).toBeGreaterThan(0); // expected in Nov before the end

    // It ended (last payment Oct 5 → ends from Nov 1).
    const r = await manage(ctx(), uid, [], { id: SPOT, action: "end" }, NOW_MS, outflow_repo, "recurring_outflow");
    expect(r.state.status).toBe("active"); // still this month's bill
    const doc = (await db.collection("outflows").doc(SPOT).get()).data()!;
    expect(doc.isActive).toBe(true); // NOT turned inactive (X4)
    expect(doc.removalIntervals).toEqual([{ fromMs: Date.UTC(2037, 10, 1), toMs: null, mode: "going_forward" }]);
    // Past periods unchanged; detail opens; nothing expected in November.
    expect(paidTotal(await h.bill(SEP, SPOT))).toBe(15.49);
    expect(paidTotal(await h.bill(OCT, SPOT))).toBe(15.49);
    expect((await h.bill(NOV, SPOT))?.groups ?? []).toEqual([]); // removed months: no occurrences
    const view = await derive_recurring_view(ctx(), uid, { kind: "outflow", recurring_id: SPOT, view_cadence: "monthly", window_start_ms: SEP.start, window_end_ms: OCT.end }, true);
    expect(view).toBeTruthy();

    // F9: a November payment posted later is NOT linked; counts as a normal transaction.
    jest.setSystemTime(Date.parse("2037-11-04T12:00:00Z"));
    const nov_before = await h.eeSpent(NOV);
    h.postTxns([plaidTxn(h.ids, { key: "spotnov", account: "chk", amount: 15.49, days_ago: 0, name: "SPOTIFY USA",
      merchant: "Spotify", primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" }, Date.parse("2037-11-03T12:00:00Z"))]);
    await h.sync("nov");
    expect((await h.txn("spotnov"))?.splits[0].outflowId ?? null).toBeNull();
    expect(await h.eeSpent(NOV)).toBe(Math.round((nov_before + 15.49) * 100) / 100);
    jest.setSystemTime(NOW_MS);

    // Removed list: shown (ending next month); Restore cancels the end.
    let list = await list_suppressed(ctx(), uid, NOW_MS);
    expect(list.items.find((i: { id: string }) => i.id === SPOT)).toMatchObject({ status: "removed", ends_ms: Date.UTC(2037, 10, 1) });
    await manage(ctx(), uid, [], { id: SPOT, action: "restore" }, NOW_MS, outflow_repo, "recurring_outflow");
    expect((await db.collection("outflows").doc(SPOT).get()).data()!.removalIntervals).toEqual([]);
    expect((await h.bill(NOV, SPOT))?.groups.length).toBeGreaterThan(0);
    list = await list_suppressed(ctx(), uid, NOW_MS);
    expect(list.items.find((i: { id: string }) => i.id === SPOT)).toBeUndefined();
    // …and after Restore the stored link follows (the re-assign the restore queues).
    await reassign_user(ctx(), { user_id: uid, reason: "recurring_removal" });

    // Merged-away bill: kept out of the Removed list; Restore blocked (no double count).
    const CCPAY = h.ids.streams.CCPAY;
    await manage(ctx(), uid, [], { id: CCPAY, action: "end" }, NOW_MS, outflow_repo, "recurring_outflow");
    await db.collection("outflows").doc(CCPAY).update({ mergedIntoId: "the_new_bill" });
    list = await list_suppressed(ctx(), uid, NOW_MS);
    expect(list.items.find((i: { id: string }) => i.id === CCPAY)).toBeUndefined();
    await expect(manage(ctx(), uid, [], { id: CCPAY, action: "restore" }, NOW_MS, outflow_repo, "recurring_outflow"))
      .rejects.toThrow(/merged/);

    // X20: the monthly extension honors the end. Drop Dec + Jan, extend: both are re-created
    // (40-day look-back, working 69a7a76) and INACTIVE.
    await manage(ctx(), uid, [], { id: SPOT, action: "end" }, NOW_MS, outflow_repo, "recurring_outflow");
    for (const p of ["2037M12", "2038M01"]) await db.collection("outflow_periods").doc(`${SPOT}_${p}`).delete();
    const created = await extendOutflowPeriodsFor(db, await db.collection("outflows").doc(SPOT).get(), new Date("2038-02-01T00:00:00Z"));
    expect(created).toBeGreaterThan(0);
    const periods = await db.collection("outflow_periods").where("outflowId", "==", SPOT).get();
    const by_id = new Map(periods.docs.map((d) => [d.id, d.data()]));
    expect(by_id.get(`${SPOT}_2037M10`)?.isActive).toBe(true);
    expect(by_id.get(`${SPOT}_2037M12`)?.isActive).toBe(false); // re-created by the look-back, flipped
    expect(by_id.get(`${SPOT}_2038M01`)?.isActive).toBe(false); // created by the extension, flipped
    expect((await h.bill(NOV, SPOT))?.groups ?? []).toEqual([]); // derive agrees

    // An OLD record's extension follows working's deployed 2ae62e6 (new periods inside the removal
    // window are created inactive, no post-pass) — this branch adds nothing for old records (D13).
    const OLDID = `${h.ids.tag}_old_bill`;
    const { captureRulesVersion: _v, plaidIsActive: _p, ...old_doc } = (await db.collection("outflows").doc(h.ids.streams.XFER).get()).data()!;
    void _v; void _p;
    await db.collection("outflows").doc(OLDID).set({
      ...old_doc, id: OLDID,
      removedByUser: true, removalIntervals: [{ fromMs: Date.UTC(2037, 10, 1), toMs: null, mode: "going_forward" }],
      firstDate: Timestamp.fromDate(new Date("2037-12-05T00:00:00Z")),
    });
    await extendOutflowPeriodsFor(db, await db.collection("outflows").doc(OLDID).get(), new Date("2038-02-01T00:00:00Z"));
    const old_periods = await db.collection("outflow_periods").where("outflowId", "==", OLDID).get();
    expect(old_periods.size).toBeGreaterThan(0);
    // Every period here starts Dec 2037+ (after the Nov 1 removal) → created inactive.
    expect(old_periods.docs.every((d) => d.data().isActive === false)).toBe(true);
  }, 240000);
});
