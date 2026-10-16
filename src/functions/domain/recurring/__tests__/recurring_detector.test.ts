import { Timestamp } from "firebase-admin/firestore";
import {
  DETECTOR_TXN_CAP,
  DetectorTxn,
  detect_candidates,
  detector_items,
  fit_cadence,
  is_bill_like_category,
} from "../recurring_detector.service";
import { make_review_item, resolve_review_item, suggested_subject, build_review_item_id } from "../review_item.service";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 15, 12);
const U = "u1";
let n = 0;
const txn = (o: { days_ago: number; merchant: string; cat: string; amount?: number; type?: string; account?: string; plaid?: string; extra?: Record<string, unknown> }): DetectorTxn => {
  n++;
  return {
    id: `doc${n}`,
    data: {
      userId: U, ownerId: U, isActive: true, isPending: false, type: o.type ?? "expense",
      transactionId: o.plaid ?? `p${n}`, accountId: o.account ?? "chk", merchantName: o.merchant, name: o.merchant.toUpperCase(),
      amount: o.amount ?? 50, plaidDetailedCategory: o.cat, transactionDate: Timestamp.fromMillis(NOW - o.days_ago * DAY),
      splits: [{ splitId: "s", amount: o.amount ?? 50, outflowId: null, inflowId: null }], ...(o.extra ?? {}),
    },
  };
};
const series = (merchant: string, cat: string, days: number[], o: Partial<Parameters<typeof txn>[0]> = {}) =>
  days.map((d) => txn({ days_ago: d, merchant, cat, ...o }));
const run = (txns: DetectorTxn[], o: Partial<Parameters<typeof detect_candidates>[0]> = {}) =>
  detect_candidates({
    user_id: U, now_ms: NOW, txns, internal_txn_ids: new Set(), record_txn_ids: new Set(),
    record_vendor_subjects: new Set(), state: null, account_types: new Map([["chk", "depository"], ["card", "credit"]]), ...o,
  });
const UTIL = "RENT_AND_UTILITIES_WATER";
const LOAN = "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT";

describe("possible-bill detector", () => {
  it("rhythm: weekly / biweekly / twice a month / monthly; never daily, quarterly or yearly", () => {
    const at = (days: number[]) => days.map((d) => NOW - d * DAY);
    expect(fit_cadence(at([0, 7, 14, 21]))?.frequency).toBe("weekly");
    expect(fit_cadence(at([0, 14, 28]))?.frequency).toBe("biweekly");
    expect(fit_cadence(at([0, 17, 31, 48]))?.frequency).toBe("semimonthly");
    expect(fit_cadence(at([8, 41, 69]))?.frequency).toBe("monthly"); // Avant: 28, 33 day gaps
    expect(fit_cadence(at([0, 1, 2, 3, 4]))).toBeNull(); // daily coffee
    expect(fit_cadence(at([0, 91, 182]))).toBeNull(); // quarterly (D17 / X12)
    expect(fit_cadence(at([0, 365]))).toBeNull();
    expect(fit_cadence(at([0, 30]))).toBeNull(); // < 3 payments
    expect(fit_cadence(at([0, 7, 30]))).toBeNull(); // mixed gaps fit no schedule
  });

  it("categories: bill-like pass; food, entertainment, personal care, transport, shopping skipped", () => {
    for (const c of [UTIL, LOAN, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "GENERAL_SERVICES_INSURANCE", "MEDICAL_PRIMARY_CARE", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"]) {
      expect([c, is_bill_like_category(c)]).toEqual([c, true]);
    }
    for (const c of ["FOOD_AND_DRINK_COFFEE", "ENTERTAINMENT_TV_AND_MOVIES", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
      "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "GENERAL_MERCHANDISE_OTHER", "TRANSFER_OUT_ACCOUNT_TRANSFER", "TRAVEL_FLIGHTS"]) {
      expect([c, is_bill_like_category(c)]).toEqual([c, false]);
    }
  });

  it("finds Avant (irregular amounts / dates); not daily coffee; not weekly coffee (food)", () => {
    const avant = [txn({ days_ago: 8, merchant: "Avant", cat: LOAN, amount: 82 }), txn({ days_ago: 41, merchant: "Avant", cat: LOAN, amount: 117 }),
      txn({ days_ago: 69, merchant: "Avant", cat: LOAN, amount: 95 })];
    const daily = series("Corner Coffee", "FOOD_AND_DRINK_COFFEE", [1, 2, 3, 4, 5, 6]);
    const weekly = series("Monday Coffee", "FOOD_AND_DRINK_COFFEE", [1, 8, 15, 22]);
    const r = run([...avant, ...daily, ...weekly]);
    expect(r.candidates.map((c) => [c.name, c.frequency, c.amount, c.payments])).toEqual([["Avant", "monthly", 95, 3]]);
    expect(r.candidates[0].next_due_ms).toBe(NOW - 8 * DAY + 30 * DAY);
  });

  it("skips what's accounted for: in a stream, held out, split-linked, internal, edge, pending, someone else's", () => {
    const water = (o: Record<string, unknown>, plaid?: string) => series("City Water", UTIL, [5, 35, 65], { extra: o, plaid });
    expect(run(water({})).candidates).toHaveLength(1);
    const in_stream = water({});
    expect(run(in_stream, { record_txn_ids: new Set(in_stream.map((t) => t.data.transactionId as string)) }).candidates).toHaveLength(0);
    const held = water({});
    expect(run(held, { state: { user_id: U, suppressed_txn_ids: held.map((t) => t.data.transactionId as string), dismissed_vendor_keys: [], detector_last_run_day: null } }).candidates).toHaveLength(0);
    expect(run(water({ splits: [{ outflowId: "bill" }] })).candidates).toHaveLength(0);
    const internal = water({});
    expect(run(internal, { internal_txn_ids: new Set(internal.map((t) => t.id)) }).candidates).toHaveLength(0);
    expect(run(water({ transferRole: "edge_out" })).candidates).toHaveLength(0);
    expect(run(water({ isPending: true })).candidates).toHaveLength(0);
    expect(run(water({ userId: "partner", ownerId: "partner" })).candidates).toHaveLength(0);
  });

  it("memory: 'Not a bill' vendor never; a vendor with a record never; stopped streams never", () => {
    const w = series("City Water", UTIL, [5, 35, 65]);
    expect(run(w, { state: { user_id: U, suppressed_txn_ids: [], dismissed_vendor_keys: [suggested_subject("outflow", "city water")], detector_last_run_day: null } }).candidates).toHaveLength(0);
    expect(run(w, { record_vendor_subjects: new Set([suggested_subject("outflow", "city water")]) }).candidates).toHaveLength(0);
    expect(run(series("Old Water", UTIL, [100, 130, 160])).candidates).toHaveLength(0); // last paid > 2 cycles ago
  });

  it("income: INCOME_* only, never on a credit / loan account (X17); asks for account types when needed", () => {
    const gig = series("Side Gig LLC", "INCOME_OTHER_INCOME", [3, 17, 31], { type: "income", amount: -300 });
    expect(run(gig).candidates.map((c) => [c.direction, c.frequency])).toEqual([["inflow", "biweekly"]]);
    const card_credit = series("Card Rewards", "INCOME_OTHER_INCOME", [3, 17, 31], { type: "income", account: "card" });
    expect(run(card_credit).candidates).toHaveLength(0);
    const pay_received = series("Payment Thank You", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", [3, 33, 63], { type: "income", account: "card" });
    expect(run(pay_received).candidates).toHaveLength(0);
    expect(run(gig, { account_types: null }).needs_account_types).toBe(true);
  });

  it("one tile per vendor: a Plaid-sourced or answered item is left alone; own open item refreshed only on change", () => {
    const r = run(series("City Water", UTIL, [5, 35, 65]));
    const c = r.candidates[0];
    expect(c.item_id).toBe(build_review_item_id(U, "suggested", suggested_subject("outflow", "city water")));
    const fresh = detector_items(U, NOW, r.candidates, new Map());
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ source: "detector", status: "open", kind: "suggested", frequency: "monthly" });
    expect(detector_items(U, NOW + 1000, r.candidates, new Map([[c.item_id, fresh[0]]]))).toEqual([]); // R5-style idempotent
    const plaid_item = make_review_item({ ...fresh[0], source: "plaid" }, NOW);
    expect(detector_items(U, NOW, r.candidates, new Map([[c.item_id, plaid_item]]))).toEqual([]);
    const dismissed = resolve_review_item(fresh[0], "not_bill", NOW);
    expect(detector_items(U, NOW, r.candidates, new Map([[c.item_id, dismissed]]))).toEqual([]);
  });

  it("bounded: only the most recent DETECTOR_TXN_CAP transactions are considered (cap reported)", () => {
    const many = Array.from({ length: DETECTOR_TXN_CAP + 5 }, (_, i) => txn({ days_ago: (i % 170) + 1, merchant: `Shop ${i % 40}`, cat: "GENERAL_MERCHANDISE_OTHER" }));
    expect(run(many).capped).toBe(true);
    expect(run(many.slice(0, 10)).capped).toBe(false);
  });
});
