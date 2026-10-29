/**
 * Emulator — D27: stored periods follow the derive's month rule (review round 3).
 *
 * Clock Oct 15 2043 (no other suite seeds 2043 source periods). Oct 1 2043 is a Thursday, so the
 * week Sun Sep 27 – Sat Oct 3 straddles a removal that starts Oct 1. Three bills per user, each
 * removed the way one A2 case needs:
 *   RA (due 29th) removed going forward from Oct 1           → case (a), week Sep 27–Oct 3;
 *   RB (due 12th) removed Sep 1, restored Oct 20             → case (b), week Oct 11–17 + Oct 1–15;
 *   RC (due 29th) paused Sep 1 → Oct 2                      → case (c), week Sep 27–Oct 3.
 * One user's bills are OLD (flag off), the other's are v2 — D27 applies to both.
 *
 *   - apply_period_suppression (remove / restore / pause) flips stored periods by the month rule;
 *   - Top-25 #13: stored vs derive parity on the boundary weeks and halves (weekly and
 *     twice-a-month), including the picker's `isActive == true` query;
 *   - both period creators (createOutflowPeriodsFromSource, extendInflowPeriodsFor) create
 *     periods inside a removal window by the same rule;
 *   - the one-off re-snap (dry run by default, write, per-user counts, writes only `isActive`,
 *     idempotent) — run per user here (the emulator is shared).
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { FAKE_CLOCK, makeHarness, plaidTxn, scenarioRecurring } from "./helpers/captureHarness";
import { plaidStream } from "./helpers/captureScenario";
import { halves, months, seedPeriods, weeks } from "./helpers/sourcePeriods";

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
const DAY = 86400000;
const T = Date.UTC(2043, 9, 15, 12);
const MONTHS: Array<[number, number]> = [[2043, 7], [2043, 8], [2043, 9], [2043, 10], [2043, 11], [2043, 12]];
const WEEKS = weeks(Date.UTC(2043, 7, 2), Date.UTC(2043, 11, 31)); // Sun Aug 2 2043 → Dec
const HALVES = halves(MONTHS);
const W_SEP27 = WEEKS.find((w) => w.start === Date.UTC(2043, 8, 27))!;
const W_OCT11 = WEEKS.find((w) => w.start === Date.UTC(2043, 9, 11))!;
const BM_OCT_A = HALVES.find((h) => h.id === "2043BM10A")!;

let db: FirebaseFirestore.Firestore;
let manage: any;
let outflow_repo: any;
let derive: any;
let resnap: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  jest.useFakeTimers({ ...FAKE_CLOCK, now: T });
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  require("../src/functions/orchestrators/plaid/sync_item.orchestrator");
  ({ derive_period_orchestrator: derive } = require("../src/functions/orchestrators/periods/derive_period.orchestrator"));
  ({ manage_recurring_removal_orchestrator: manage } = require("../src/functions/orchestrators/recurring/manage_recurring_removal.orchestrator"));
  ({ outflow_repo } = require("../src/functions/repositories"));
  ({ resnap_period_suppression_orchestrator: resnap } = require("../src/functions/orchestrators/recurring/resnap_period_suppression.orchestrator"));
  db = admin.firestore();
  await seedPeriods(db, [...months(MONTHS), ...WEEKS, ...HALVES]);
}, 60000);
afterAll(() => jest.useRealTimers());

const mocks = { mockSync, mockRecurring };
const ctx = () => ({ trace_id: `t_${Math.random()}`, span_id: "s" });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const days_ago = (ms: number) => Math.round((T - ms) / DAY);

const BILLS = {
  RA: { day: 29, vendor: "Landlord A", paid: [Date.UTC(2043, 7, 29, 12), Date.UTC(2043, 8, 29, 12)] },
  RB: { day: 12, vendor: "Utility B", paid: [Date.UTC(2043, 7, 12, 12), Date.UTC(2043, 8, 12, 12), Date.UTC(2043, 9, 12, 12)] },
  RC: { day: 29, vendor: "Gym C", paid: [Date.UTC(2043, 7, 29, 12), Date.UTC(2043, 8, 29, 12)] },
} as const;

/** A user with RA / RB / RC (v2 when `flag`), periods generated, then removed per case. */
async function caseUser(tag: string, flag: boolean) {
  const h = await makeHarness(db, tag, mocks, { flag });
  const streams: any[] = [];
  const txns: any[] = [];
  for (const [name, b] of Object.entries(BILLS)) {
    h.ids.streams[name] = `${tag}_S_${name}`;
    const keys = b.paid.map((_, i) => `${name}${i}`);
    b.paid.forEach((ms, i) => txns.push(plaidTxn(h.ids, { key: keys[i], account: "chk", amount: 100, days_ago: days_ago(ms),
      name: b.vendor.toUpperCase(), merchant: b.vendor, primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" }, T)));
    const last = b.paid[b.paid.length - 1];
    streams.push(plaidStream(h.ids, name, {
      account: "chk", keys, amount: 100, description: b.vendor.toUpperCase(), merchant: b.vendor, primary: "RENT_AND_UTILITIES",
      detailed: "RENT_AND_UTILITIES_RENT", frequency: "MONTHLY", status: "MATURE", is_active: true,
      first_days_ago: days_ago(b.paid[0]), last_days_ago: days_ago(last),
      next_days: Math.round((Date.UTC(2043, 9 + (b.day < 15 ? 1 : 0), b.day, 12) - T) / DAY),
    } as any, T));
  }
  h.postTxns(txns);
  h.setRecurring({ ...scenarioRecurring(h.ids, {}, T), outflow_streams: streams, inflow_streams: [] });
  await h.sync("link");
  const uid = h.ids.userId;
  const S = h.ids.streams;
  for (const id of [S.RA, S.RB, S.RC]) {
    const d = (await db.collection("outflows").doc(id).get()).data()!;
    expect(d.captureRulesVersion ?? null).toBe(flag ? 2 : null);
  }
  const m = (id: string, input: any, now: number) => manage(ctx(), uid, [], { id, ...input }, now, outflow_repo, "recurring_outflow");
  await m(S.RA, { action: "remove", mode: "going_forward" }, T); // from Oct 1
  await m(S.RB, { action: "remove", mode: "going_forward" }, Date.UTC(2043, 8, 10)); // from Sep 1
  await m(S.RB, { action: "restore" }, Date.UTC(2043, 9, 20)); // restored Oct 20
  await m(S.RC, { action: "pause", resume_ms: Date.UTC(2043, 9, 2) }, Date.UTC(2043, 8, 10)); // Sep 1 → Oct 2
  return { h, uid, S };
}

const periodOf = async (bill: string, sp: { id: string }) =>
  (await db.collection("outflow_periods").doc(`${bill}_${sp.id}`).get()).data();
const view = async (uid: string, cadence: string, w: { start: number; end: number }, bill: string) => {
  const r = await derive(ctx(), uid, { view_cadence: cadence, window_start_ms: w.start, window_end_ms: w.end, force: true });
  const b = r.bills.find((x: any) => x.recurring_id === bill);
  return { listed: !!b, occ: (b?.groups ?? []).flatMap((g: any) => g.occurrences).map((o: any) => [iso(o.due_ms), o.paid]) };
};

describe("D27 — stored periods follow the month rule (emulator)", () => {
  for (const [label, flag] of [["old records", false], ["v2 records", true]] as const) {
    it(`#13 ${label}: boundary weeks / halves — stored isActive matches the period page; the picker offers them`, async () => {
      const { uid, S } = await caseUser(`qzd27${flag ? "v" : "o"}`, flag);
      // (a) RA: the week straddling the Oct 1 removal keeps the Sep 29 payment.
      expect((await periodOf(S.RA, W_SEP27))?.isActive).toBe(true);
      expect(await view(uid, "weekly", W_SEP27, S.RA)).toEqual({ listed: true, occ: [["2043-09-29", true]] });
      // (b) RB: restored Oct 20 → the Oct 12 week and the Oct 1–15 half show (and are active).
      expect((await periodOf(S.RB, W_OCT11))?.isActive).toBe(true);
      expect((await view(uid, "weekly", W_OCT11, S.RB)).occ).toEqual([["2043-10-12", true]]);
      expect((await periodOf(S.RB, BM_OCT_A))?.isActive).toBe(true);
      expect((await view(uid, "bi_monthly", BM_OCT_A, S.RB)).occ).toEqual([["2043-10-12", true]]);
      // (c) RC: paused to Oct 2 → listed with no occurrence (the Sep 29 one is in a paused month).
      expect((await periodOf(S.RC, W_SEP27))?.isActive).toBe(true);
      expect(await view(uid, "weekly", W_SEP27, S.RC)).toEqual({ listed: true, occ: [] });

      // Parity sweep: every weekly / twice-a-month period of the three bills.
      const periods = (await db.collection("outflow_periods").where("ownerId", "==", uid).get()).docs.map((d) => d.data())
        .filter((p) => [S.RA, S.RB, S.RC].includes(p.outflowId) && p.periodType !== "monthly");
      expect(periods.length).toBeGreaterThan(20);
      const mismatches: string[] = [];
      for (const p of periods) {
        const w = { start: p.periodStartDate.toMillis(), end: p.periodEndDate.toMillis() };
        const v = await view(uid, p.periodType, w, p.outflowId);
        const shown_occ = v.occ.length > 0;
        // The page shows a payment / due date in this period → the picker must offer it…
        if (shown_occ && p.isActive !== true) mismatches.push(`${p.id}: page shows ${JSON.stringify(v.occ)} but inactive`);
        // …and an active period with occurrences that the page drops entirely only exists when the
        // period isn't removed as a whole (case (c): listed, its occurrence's month removed).
        const due = (p.occurrenceDueDates ?? p.occurrences?.map((o: any) => o.dueDate) ?? []).length;
        if (p.isActive === true && due > 0 && !shown_occ) {
          const { is_suppressed_in_period } = require("../src/functions/domain/recurring/recurring_suppression.service");
          const iv = ((await db.collection("outflows").doc(p.outflowId).get()).data()!.removalIntervals as any[])
            .map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode }));
          if (is_suppressed_in_period(iv, w.end)) mismatches.push(`${p.id}: active but removed and the page shows nothing`);
        }
      }
      expect(mismatches).toEqual([]);

      // The picker's query (isActive == true) includes the boundary periods.
      const active = new Set((await db.collection("outflow_periods").where("ownerId", "==", uid).where("isActive", "==", true).get())
        .docs.map((d) => d.id));
      for (const id of [`${S.RA}_${W_SEP27.id}`, `${S.RB}_${W_OCT11.id}`, `${S.RB}_${BM_OCT_A.id}`]) expect(active.has(id)).toBe(true);
      // …and never a fully removed one: RA's week of Oct 4 (no payment, removed).
      expect(active.has(`${S.RA}_${WEEKS.find((x) => x.start === Date.UTC(2043, 9, 4))!.id}`)).toBe(false);
    }, 300000);
  }

  /** A raw bill / income doc removed going forward from Oct 1 2043, due the 29th. */
  const rawRecord = (id: string, owner: string, v2: boolean, kind: "outflow" | "inflow") => ({
    id, ownerId: owner, userId: owner, createdBy: owner, groupId: null, groupIds: [], accountId: `${owner}_chk`, plaidItemId: `${owner}_item`,
    description: `${kind} ${id}`, merchantName: "Vendor", frequency: "monthly", averageAmount: kind === "outflow" ? 100 : -100,
    firstDate: Timestamp.fromMillis(Date.UTC(2043, 0, 29)), lastDate: Timestamp.fromMillis(Date.UTC(2043, 8, 29)),
    predictedNextDate: Timestamp.fromMillis(Date.UTC(2043, 9, 29)), isActive: true, isHidden: false, source: "plaid",
    removalIntervals: [{ fromMs: Date.UTC(2043, 9, 1), toMs: null, mode: "going_forward" }],
    ...(v2 ? { captureRulesVersion: 2 } : {}),
  });
  const W_OCT4 = WEEKS.find((w) => w.start === Date.UTC(2043, 9, 4))!;

  for (const v2 of [false, true]) {
    it(`both period creators apply the month rule inside a removal window (${v2 ? "v2" : "old"} records)`, async () => {
      const { createOutflowPeriodsFromSource } = require("../src/functions/outflows/outflow_periods/crud/createOutflowPeriods");
      const { extendInflowPeriodsFor } = require("../src/functions/inflows/orchestration/scheduled/extendRecurringInflowPeriods");
      const owner = `qzd27cr${v2 ? "v" : "o"}`;
      const oid = `${owner}_out`;
      const out = rawRecord(oid, owner, v2, "outflow");
      await db.collection("outflows").doc(oid).set(out);
      await createOutflowPeriodsFromSource(db, oid, out, new Date(Date.UTC(2043, 8, 1)), new Date(Date.UTC(2043, 10, 30)), { skip_existing: true });
      const op = async (sp: { id: string }) => (await db.collection("outflow_periods").doc(`${oid}_${sp.id}`).get()).data()!;
      expect((await op(W_SEP27)).isActive).toBe(true); // Sep 29 occurrence, Sep not removed
      expect((await op(W_OCT4)).isActive).toBe(false);
      expect((await op({ id: "2043M09" })).isActive).toBe(true);
      expect((await op({ id: "2043M10" })).isActive).toBe(false);
      expect((await op({ id: "2043BM09B" })).isActive).toBe(true);
      expect((await op({ id: "2043BM10A" })).isActive).toBe(false);

      const iid = `${owner}_in`;
      const inf = rawRecord(iid, owner, v2, "inflow");
      await db.collection("inflows").doc(iid).set(inf);
      const sources = [...months(MONTHS), ...WEEKS, ...HALVES]
        .filter((p) => p.start >= Date.UTC(2043, 8, 1) && p.start < Date.UTC(2043, 11, 1))
        .map((p) => ({ id: p.id, type: p.type, startDate: Timestamp.fromMillis(p.start), endDate: Timestamp.fromMillis(p.end) }));
      const created = await extendInflowPeriodsFor(db, await db.collection("inflows").doc(iid).get(), sources, Timestamp.fromMillis(T));
      expect(created).toBe(sources.length);
      const ip = async (sp: { id: string }) => (await db.collection("inflow_periods").doc(`${iid}_${sp.id}`).get()).data()!;
      expect((await ip(W_SEP27)).isActive).toBe(true);
      expect((await ip(W_OCT4)).isActive).toBe(false); // before D27: created active (old records never flipped)
      expect((await ip({ id: "2043M09" })).isActive).toBe(true);
      expect((await ip({ id: "2043M10" })).isActive).toBe(false);
      expect((await ip({ id: "2043BM10B" })).isActive).toBe(false);
    }, 120000);
  }

  it("the one-off re-snap: dry run by default, per-user counts, writes only isActive where it differs, idempotent; scoped to the old rule's state (round 4 test 4)", async () => {
    const owners = ["qzd27sa", "qzd27sb"];
    const seedUser = async (owner: string, v2: boolean) => {
      // A removed bill + income whose stored periods were written under the OLD whole-period rule
      // (the straddling week inactive), an inactive record (account removed: never touched) and a
      // bill with no intervals whose period is inactive for another reason (never touched).
      for (const kind of ["outflow", "inflow"] as const) {
        const id = `${owner}_${kind}`;
        await db.collection(`${kind}s`).doc(id).set(rawRecord(id, owner, v2, kind));
      }
      await db.collection("outflows").doc(`${owner}_gone`).set({ ...rawRecord(`${owner}_gone`, owner, v2, "outflow"), isActive: false });
      await db.collection("outflows").doc(`${owner}_plain`).set({ ...rawRecord(`${owner}_plain`, owner, v2, "outflow"), removalIntervals: [] });
      const occ = (ms: number) => ({ dueDate: Timestamp.fromMillis(ms) });
      const period = (kind: "outflow" | "inflow", rid: string, sp: { id: string; start: number; end: number; type: string }, active: boolean, due: number[]) => ({
        id: `${rid}_${sp.id}`, [`${kind}Id`]: rid, ownerId: owner, sourcePeriodId: sp.id, periodType: sp.type,
        periodStartDate: Timestamp.fromMillis(sp.start), periodEndDate: Timestamp.fromMillis(sp.end), isActive: active,
        updatedAt: Timestamp.fromMillis(Date.UTC(2043, 0, 1)), note: "keep me", totalAmountDue: 100,
        ...(kind === "outflow" ? { occurrences: due.map(occ) } : { occurrenceDueDates: due.map((ms) => Timestamp.fromMillis(ms)) }),
      });
      const OCT = months(MONTHS).find((m) => m.id === "2043M10")!;
      const SEP = months(MONTHS).find((m) => m.id === "2043M09")!;
      const AUG = months(MONTHS).find((m) => m.id === "2043M08")!;
      const batch = db.batch();
      for (const kind of ["outflow", "inflow"] as const) {
        const rid = `${owner}_${kind}`;
        const put = (sp: any, active: boolean, due: number[]) => batch.set(db.collection(`${kind}_periods`).doc(`${rid}_${sp.id}`), period(kind, rid, sp, active, due));
        put(W_SEP27, false, [Date.UTC(2043, 8, 29)]); // WRONG under D27 → true
        put(W_OCT4, false, []); // right
        put(SEP, true, [Date.UTC(2043, 8, 29)]); // right
        // Round 4 defect 4 — the re-snap flips ONLY periods still in the OLD whole-period rule's state:
        put(OCT, true, [Date.UTC(2043, 9, 29)]); // active inside the window (both rules: inactive) → NOT flipped, reported
        put(AUG, false, [Date.UTC(2043, 7, 29)]); // inactive for ANOTHER reason (both rules: active) → left alone
      }
      batch.set(db.collection("outflow_periods").doc(`${owner}_gone_${W_SEP27.id}`), period("outflow", `${owner}_gone`, W_SEP27 as any, false, [Date.UTC(2043, 8, 29)]));
      batch.set(db.collection("outflow_periods").doc(`${owner}_plain_${W_OCT4.id}`), period("outflow", `${owner}_plain`, W_OCT4 as any, false, []));
      await batch.commit();
    };
    await seedUser(owners[0], false);
    await seedUser(owners[1], true);
    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const owner of owners) for (const col of ["outflow_periods", "inflow_periods"]) {
        for (const d of (await db.collection(col).where("ownerId", "==", owner).get()).docs) out[`${col}/${d.id}`] = d.data();
      }
      return out;
    };
    const before = await snapshot();

    // Dry run (the default): counts per user, nothing written.
    const dry = await resnap(ctx(), { user_id: owners[0] });
    expect(dry.write).toBe(false);
    // Old income's in-window period is reported on its own (not flipped); the old bill's under "other".
    expect(dry.by_user).toEqual({ [owners[0]]: {
      outflows: 1, outflow_periods_to_flip: 1, inflows: 1, inflow_periods_to_flip: 1, old_income_in_window_periods: 1, other_in_window_periods: 1,
    } });
    expect(await snapshot()).toEqual(before);
    // All users, still a dry run: both test users reported with their counts (others may exist too).
    const all = await resnap(ctx(), {});
    expect(all.by_user[owners[0]]).toEqual(dry.by_user[owners[0]]);
    expect(all.by_user[owners[1]]).toEqual({ // v2 records: nothing is "old income"
      outflows: 1, outflow_periods_to_flip: 1, inflows: 1, inflow_periods_to_flip: 1, old_income_in_window_periods: 0, other_in_window_periods: 2,
    });
    expect(await snapshot()).toEqual(before);

    // Write, per user: only isActive changes, only where it was wrong.
    for (const owner of owners) {
      const w = await resnap(ctx(), { user_id: owner, write: true });
      expect([w.write, w.periods_flipped]).toEqual([true, 2]);
    }
    const after = await snapshot();
    const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
    expect(changed).toEqual(owners.flatMap((o) => ["outflow", "inflow"].flatMap((k) => [
      `${k}_periods/${o}_${k}_${W_SEP27.id}`,
    ])).sort()); // never the in-window active OCT nor the otherwise-inactive AUG
    for (const k of changed) {
      const { isActive: a, ...rest_a } = before[k] as any;
      const { isActive: b, ...rest_b } = after[k] as any;
      expect(b).toBe(!a);
      expect(rest_b).toEqual(rest_a); // updatedAt and every other field untouched
    }
    // Idempotent.
    for (const owner of owners) expect((await resnap(ctx(), { user_id: owner, write: true })).periods_flipped).toBe(0);
    expect(await snapshot()).toEqual(after);
  }, 120000);
});

