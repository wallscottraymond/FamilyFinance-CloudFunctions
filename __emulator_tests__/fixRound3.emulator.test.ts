/**
 * Emulator — fix round 3: a resume redoes the periods + follow-ups unless their marker is set (and
 * recomputes the source split's budget), a rollback is guarded against a racing sync, a true
 * simultaneous double tap, a paused bill whose pause ends, a failed / partial period generation
 * leaves no marker (the next tap regenerates), and the preview agrees with the convert (weekly).
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern fixRound3"
 */
import * as admin from "firebase-admin";
import { FAKE_CLOCK, OCT, makeHarness, paidTotal, plaidTxn, scenarioRecurring, seedMonths, setFlag } from "./helpers/captureHarness";
import { NOW_MS, plaidStream } from "./helpers/captureScenario";

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
let convert: any; let answer: any; let manage: any; let outflow_repo: any; let preview: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  require("../src/functions/orchestrators/periods/derive_period.orchestrator");
  ({ convert_transaction_to_recurring_orchestrator: convert } = require("../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator"));
  ({ answer_recurring_review_item_orchestrator: answer } = require("../src/functions/orchestrators/recurring/answer_recurring_review_item.orchestrator"));
  ({ manage_recurring_removal_orchestrator: manage } = require("../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator"));
  ({ outflow_repo } = require("../src/functions/repositories/outflow.repo"));
  ({ preview_convert_transaction_orchestrator: preview } = require("../src/functions/orchestrators/recurring/preview_convert_transaction.orchestrator"));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const ago = (y: number, m: number, d: number) => Math.round((Date.UTC(2037, 9, 15) - Date.UTC(y, m - 1, d)) / DAY);
const ll = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: "chk", amount: 1500, days_ago, name: "LANDLORD LLC", merchant: "Landlord LLC", primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" }), ...o,
});
const RENT = { name: "Rent", amount: 1500, frequency: "monthly", next_due_date: "2037-11-03", link_past: true };
const doc = (h: any, k: string) => `plaid_${h.ids.txn(k)}`;
const version = async (uid: string) => ((await db.collection("user_data_versions").doc(uid).get()).data()?.version as number | undefined) ?? 0;
async function fresh_rent(tag: string) {
  const h = await makeHarness(db, tag, mocks, { flag: true });
  await h.sync("link");
  h.postTxns([ll(h.ids, "oct", ago(2037, 10, 3)), ll(h.ids, "sep", ago(2037, 9, 3)), ll(h.ids, "aug", ago(2037, 8, 3))]);
  await h.sync("rent");
  return h;
}
const bill_of = async (uid: string) => (await db.collection("outflows").where("ownerId", "==", uid).where("vendorKey", "==", "landlord llc").get()).docs;

describe("fix round 3 (emulator)", () => {
  it("1: a convert whose follow-ups failed is finished by the resume — bill paid, source budget recomputed (same as an uninterrupted convert), marker stamped, bump lands", async () => {
    const h = await fresh_rent("qzh1");
    const twin = await fresh_rent("qzh1t");
    await convert(ctx(), twin.ids.userId, { transaction_id: doc(twin, "oct"), ...RENT }, NOW_MS);
    const fu = require("../src/functions/orchestrators/plaid/sync_follow_ups");
    const spy = jest.spyOn(fu, "run_sync_follow_ups").mockRejectedValue(new Error("died"));
    const v0 = await version(h.ids.userId);
    await expect(convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS)).rejects.toThrow();
    spy.mockRestore();
    expect(await version(h.ids.userId)).toBeGreaterThan(v0); // death before follow-ups is bumped
    const [b] = await bill_of(h.ids.userId);
    expect(b.data().followUpsDoneAtMs).toBeUndefined();
    expect(b.data().retroLinkedAtMs).toBeUndefined();
    await b.ref.update({ resumeLeaseMs: 0 });
    const v1 = await version(h.ids.userId);
    await convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS);
    const after = (await b.ref.get()).data()!;
    expect(after.followUpsDoneAtMs).toBeGreaterThan(0);
    expect(after.retroLinkedAtMs).toBeGreaterThan(0);
    expect(await version(h.ids.userId)).toBeGreaterThan(v1); // the resume bumps
    expect(paidTotal(await h.bill(OCT, b.id))).toBe(1500);
    expect(await h.eeSpent(OCT)).toBe(await twin.eeSpent(OCT)); // the source split left its budget
  }, 400000);

  it("1b: a resume that dies again is bumped too", async () => {
    const h = await fresh_rent("qzh1b");
    const fu = require("../src/functions/orchestrators/plaid/sync_follow_ups");
    const spy = jest.spyOn(fu, "run_sync_follow_ups").mockRejectedValue(new Error("died"));
    await expect(convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS)).rejects.toThrow();
    const [b] = await bill_of(h.ids.userId);
    await b.ref.update({ resumeLeaseMs: 0 });
    const v0 = await version(h.ids.userId);
    await expect(convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS)).rejects.toThrow();
    spy.mockRestore();
    expect(await version(h.ids.userId)).toBeGreaterThan(v0);
  }, 300000);

  it("2: a rollback does not re-open an item a racing sync already consumed (track gone) — the answer stands", async () => {
    const tag = "qzh2";
    const h = await makeHarness(db, tag, mocks, { flag: false });
    h.setRecurring(scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE" } }));
    await h.sync("link");
    await setFlag(db, [h.ids.userId]);
    h.ids.streams.SUNBIT2 = `${tag}_S_SUNBIT2`;
    const rec = scenarioRecurring(h.ids, { SUNBIT: { status: "MATURE", is_active: false } });
    rec.outflow_streams.push(plaidStream(h.ids, "SUNBIT2", { account: "chk", keys: ["sbn1"], amount: 60, description: "SUNBIT", merchant: "Sunbit", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "MONTHLY", status: "MATURE", is_active: true, first_days_ago: 1, last_days_ago: 1, next_days: 29 }));
    h.setRecurring(rec);
    h.postTxns([plaidTxn(h.ids, { key: "sbn1", account: "chk", amount: 60, days_ago: 1, name: "SUNBIT", merchant: "Sunbit", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" })]);
    await h.sync("switch");
    const item = (await db.collection("recurring_review_items").where("userId", "==", h.ids.userId).where("kind", "==", "same_bill").get()).docs[0].data();
    const { recurring_review_repo } = require("../src/functions/repositories/recurring_review.repo");
    const mod = require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
    const spy = jest.spyOn(mod, "enqueue_item_sync").mockImplementation(async () => {
      // the racing sync consumes the track before the rollback runs
      await recurring_review_repo.apply_state_change(ctx(), h.ids.userId, { remove_pending_track_ids: [item.id] });
      throw new Error("queue down");
    });
    await expect(answer(ctx(), h.ids.userId, { item_id: item.id, answer: "same_bill" }, NOW_MS)).rejects.toThrow();
    spy.mockRestore();
    const after = (await db.collection("recurring_review_items").doc(item.id).get()).data()!;
    expect(after.status).not.toBe("open");
    expect((await db.collection("outflows").doc(h.ids.streams.SUNBIT).get()).data()!.mergedIntoId).toBeDefined(); // the merge stays with the answer
  }, 300000);

  it("3: two taps at the same instant make ONE bill; neither is told \"already part of a bill\"", async () => {
    const h = await fresh_rent("qzh3");
    const call = () => convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS).then((r: any) => r, (e: any) => e);
    const [a, b] = await Promise.all([call(), call()]);
    for (const r of [a, b]) expect(r.code).not.toBe("ALREADY_TRACKED");
    expect(await bill_of(h.ids.userId)).toHaveLength(1);
    expect([a, b].filter((r) => r.already === false || r.already === undefined).length).toBeLessThanOrEqual(1);
  }, 300000);

  it("3b: a paused bill stays live while paused and after the pause ends", async () => {
    const h = await makeHarness(db, "qzh4", mocks, { flag: true });
    await h.sync("link");
    await manage(ctx(), h.ids.userId, [], { id: h.ids.streams.SPOT, action: "pause", resume_ms: NOW_MS + 2 * DAY }, NOW_MS, outflow_repo, "recurring_outflow");
    const req = { transaction_id: doc(h, "spot0"), name: "Spotify", amount: 15.49, frequency: "monthly", next_due_date: "2037-11-05", link_past: false };
    expect((await convert(ctx(), h.ids.userId, req, NOW_MS).catch((e: any) => e)).code).toBe("ALREADY_TRACKED");
    jest.setSystemTime(NOW_MS + 3 * DAY);
    try {
      expect((await convert(ctx(), h.ids.userId, req, NOW_MS + 3 * DAY).catch((e: any) => e)).code).toBe("ALREADY_TRACKED");
    } finally { jest.setSystemTime(NOW_MS); }
  }, 240000);

  it("4: a failed period generation leaves no marker and gives the lease back; the next tap regenerates and completes", async () => {
    const h = await fresh_rent("qzh5");
    const gen = require("../src/functions/orchestrators/outflows/generate_outflow_periods.orchestrator");
    const spy = jest.spyOn(gen, "generate_outflow_periods_orchestrator").mockResolvedValue({ success: false, periods_created: 0, errors: ["boom"], trace_id: "t" });
    const first = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS);
    spy.mockRestore();
    expect(first.in_progress).toBe(true);
    const [b] = await bill_of(h.ids.userId);
    expect(b.data().retroLinkedAtMs).toBeUndefined();
    expect(b.data().followUpsDoneAtMs).toBeUndefined();
    expect((await db.collection("outflow_periods").where("outflowId", "==", b.id).get()).size).toBe(0);
    const again = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, "oct"), ...RENT }, NOW_MS); // no lease wait
    expect(again.in_progress).toBeUndefined();
    expect((await b.ref.get()).data()!.retroLinkedAtMs).toBeGreaterThan(0);
    expect((await db.collection("outflow_periods").where("outflowId", "==", b.id).get()).size).toBeGreaterThan(0);
  }, 300000);

  it("5: weekly — the preview and the convert agree on how many past payments link", async () => {
    const h = await makeHarness(db, "qzh6", mocks, { flag: true });
    await h.sync("link");
    h.postTxns([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ll(h.ids, `w${i}`, 2 + i * 7, { amount: 25, name: "WEEKLY GYM", merchant: "Weekly Gym" })));
    await h.sync("weekly");
    const p = await preview(ctx(), h.ids.userId, { transaction_id: doc(h, "w1") }, NOW_MS);
    const g = p.schedule_guess;
    expect(g).toBeTruthy();
    const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const r = await convert(ctx(), h.ids.userId, { transaction_id: doc(h, "w1"), name: "Gym", amount: 25, frequency: g.frequency, next_due_date: ymd(g.next_due_ms), link_past: true }, NOW_MS);
    expect(r.linked_past_count).toBe(p.linkable_count);
  }, 300000);
});
