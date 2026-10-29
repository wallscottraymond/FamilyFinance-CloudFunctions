/**
 * Emulator — Top-25 #25 "old inflow extension byte-identity".
 *
 * The same seed (old income records — no capture stamp) runs through HEAD's `extendInflowPeriodsFor`
 * and through the base 2ae62e6 body (helpers/legacyInflowExtension.ts, copied verbatim). Twin
 * records differ only in their id; the period docs they produce are compared field by field
 * (ids normalized, `createdAt` / `updatedAt` / `lastCalculated` are the injected `now` on both).
 *   - a plain income → byte-identical;
 *   - a hidden income (deliberate) → identical except `isHidden`, now copied from the income like
 *     the outflow creator does since 2ae62e6 (base: hard-coded false) — user-approved (D30,
 *     2026-10-16; f3fcf7a);
 *   - a removed income (D27, deliberate) → identical except `isActive`, which now follows the
 *     month rule inside the removal window (base: every new period active).
 * Its own year (2044); source periods are passed in, never stored.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { legacyExtendInflowPeriodsFor } from "./helpers/legacyInflowExtension";
import { halves, months, weeks } from "./helpers/sourcePeriods";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let extendInflowPeriodsFor: any;
let is_stored_period_active: any;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  db = admin.firestore();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ extendInflowPeriodsFor } = require("../src/functions/inflows/orchestration/scheduled/extendRecurringInflowPeriods"));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ is_stored_period_active } = require("../src/functions/domain/recurring/recurring_suppression.service"));
});

const NOW = Timestamp.fromMillis(Date.UTC(2044, 4, 1, 2));
const SOURCES = [
  ...months([[2044, 5], [2044, 6], [2044, 7], [2044, 8]]),
  ...weeks(Date.UTC(2044, 4, 1), Date.UTC(2044, 8, 1)), // May 1 2044 is a Sunday
  ...halves([[2044, 5], [2044, 6], [2044, 7], [2044, 8]]),
].map((p) => ({ id: p.id, type: p.type, startDate: Timestamp.fromMillis(p.start), endDate: Timestamp.fromMillis(p.end) }));

const record = (o: Record<string, unknown> = {}) => ({
  ownerId: "qzinfid_u", userId: "qzinfid_u", createdBy: "qzinfid_u", groupId: null, accountId: "qzinfid_chk",
  plaidItemId: "qzinfid_item", description: "ACME PAYROLL", merchantName: "Acme", frequency: "BIWEEKLY",
  averageAmount: -2000, firstDate: Timestamp.fromMillis(Date.UTC(2044, 0, 8)), lastDate: Timestamp.fromMillis(Date.UTC(2044, 3, 29)),
  predictedNextDate: Timestamp.fromMillis(Date.UTC(2044, 4, 13)), isActive: true, isHidden: false, source: "plaid",
  plaidPrimaryCategory: "INCOME", plaidDetailedCategory: "INCOME_WAGES", currency: "USD", tags: [], ...o,
});

async function twinPeriods(name: string, o: Record<string, unknown>) {
  const head_id = `qzinfid_${name}_head`;
  const base_id = `qzinfid_${name}_base`;
  await db.collection("inflows").doc(head_id).set(record(o));
  await db.collection("inflows").doc(base_id).set(record(o));
  const n_head = await extendInflowPeriodsFor(db, await db.collection("inflows").doc(head_id).get(), SOURCES, NOW);
  const n_base = await legacyExtendInflowPeriodsFor(db, await db.collection("inflows").doc(base_id).get(), SOURCES as any, NOW);
  expect(n_head).toBe(n_base);
  const load = async (id: string) => {
    const snap = await db.collection("inflow_periods").where("inflowId", "==", id).get();
    return new Map(snap.docs.map((d) => [d.data().sourcePeriodId as string, JSON.parse(JSON.stringify(d.data()).split(id).join("ID"))]));
  };
  return { head: await load(head_id), base: await load(base_id), n: n_head };
}

describe("old inflow extension: HEAD == the 2ae62e6 body (emulator)", () => {
  it("a plain old income → byte-identical period docs", async () => {
    const { head, base, n } = await twinPeriods("plain", {});
    expect(n).toBe(SOURCES.length);
    expect([...head.keys()].sort()).toEqual([...base.keys()].sort());
    for (const [k, doc] of head) expect({ k, doc }).toEqual({ k, doc: base.get(k) });
  });

  it("a hidden old income → identical except isHidden, which now copies the income (base: always false)", async () => {
    const { head, base } = await twinPeriods("hidden", { isHidden: true });
    for (const [k, doc] of head) {
      const { isHidden: h1, ...r1 } = doc;
      const { isHidden: h2, ...r2 } = base.get(k)!;
      expect({ k, doc: r1 }).toEqual({ k, doc: r2 });
      expect([k, h1, h2]).toEqual([k, true, false]);
    }
  });

  it("removed old income → identical except isActive, which follows the D27 month rule", async () => {
    const intervals = [{ fromMs: Date.UTC(2044, 5, 1), toMs: null, mode: "going_forward" }]; // from Jun 1
    const { head, base } = await twinPeriods("removed", { removalIntervals: intervals });
    const iv = intervals.map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode }));
    let flipped = 0;
    for (const [k, doc] of head) {
      const b = base.get(k)!;
      const { isActive: a1, ...r1 } = doc;
      const { isActive: a2, ...r2 } = b;
      expect({ k, doc: r1 }).toEqual({ k, doc: r2 });
      expect(a2).toBe(true); // the base made every new period active
      const due = (doc.occurrenceDueDates ?? []).map((t: any) => t._seconds * 1000 + Math.round((t._nanoseconds ?? 0) / 1e6));
      expect({ k, a1 }).toEqual({ k, a1: is_stored_period_active(iv, Date.parse(SOURCES.find((s) => s.id === k)!.endDate.toDate().toISOString()), due) });
      if (!a1) flipped++;
    }
    expect(flipped).toBeGreaterThan(10); // June onward: inactive (not a no-op test)
    expect(head.get("2044M05")!.isActive).toBe(true);
    expect(head.get("2044M06")!.isActive).toBe(false);
  });
});
