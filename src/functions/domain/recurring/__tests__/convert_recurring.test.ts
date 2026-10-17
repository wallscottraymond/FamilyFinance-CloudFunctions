/**
 * Convert-To-Recurring Phase 2 — the pure convert rules: keys, schedule math, which past payments a
 * convert links (D2 / D40 / D45 / D46), the first date, the schedule guess, the record builder.
 */
import {
  CONVERT_AMOUNT_MAX,
  build_converted_recurring,
  clamp_next_due,
  compute_first_date,
  converted_key,
  floor_first_date,
  guess_schedule,
  is_converted_candidate,
  parse_iso_date,
  select_retro_payments,
  step_cadence,
  utc_day_start,
  PaymentCandidate,
} from "../convert_recurring.service";
import { carried_convert_fields } from "../../../repositories/convert_doc_fields";

const DAY = 86_400_000;
const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
const NOW = Date.parse("2037-10-15T12:00:00Z");

const pay = (id: string, date_ms: number, amount = 10): PaymentCandidate => ({ id, plaid_id: `p_${id}`, date_ms, amount });

describe("keys + predicates", () => {
  it("builds the D1 key from direction | account | vendor", () => {
    expect(converted_key("outflow", "acc1", "netflix")).toBe("outflow|acc1|netflix");
    expect(converted_key("inflow", "acc1", "netflix")).not.toBe(converted_key("outflow", "acc1", "netflix"));
  });
  it("only v2 + manual + vendorKey + account is a converted candidate", () => {
    const ok = { captureRulesVersion: 2, source: "manual", vendorKey: "x", accountId: "a" };
    expect(is_converted_candidate(ok)).toBe(true);
    expect(is_converted_candidate({ ...ok, captureRulesVersion: undefined })).toBe(false);
    expect(is_converted_candidate({ ...ok, source: "plaid" })).toBe(false);
    expect(is_converted_candidate({ ...ok, vendorKey: "" })).toBe(false);
    expect(is_converted_candidate({ ...ok, accountId: "" })).toBe(false);
    expect(is_converted_candidate({ capture_rules_version: 2, source: "manual", vendor_key: "x", account_id: "a" })).toBe(true);
  });
});

describe("dates", () => {
  it("parses only real calendar dates", () => {
    expect(parse_iso_date("2037-02-28")).toBe(d(2037, 2, 28));
    expect(parse_iso_date("2037-02-30")).toBeNull();
    expect(parse_iso_date("2037-2-3")).toBeNull();
    expect(parse_iso_date("junk")).toBeNull();
  });
  it("steps monthly on the anchor day, clamped to month end", () => {
    expect(step_cadence(d(2037, 1, 31), "monthly", 1)).toBe(d(2037, 2, 28));
    expect(step_cadence(d(2037, 1, 31), "monthly", 2)).toBe(d(2037, 3, 31));
    expect(step_cadence(d(2037, 3, 15), "monthly", -1)).toBe(d(2037, 2, 15));
    expect(step_cadence(d(2037, 3, 15), "weekly", 2)).toBe(d(2037, 3, 29));
    expect(step_cadence(d(2037, 3, 15), "quarterly", 1)).toBe(d(2037, 6, 15));
    expect(step_cadence(d(2037, 3, 15), "yearly", 1)).toBe(d(2038, 3, 15));
  });
  it("steps semimonthly across the two fixed days", () => {
    expect(step_cadence(d(2037, 1, 1), "semimonthly", 1)).toBe(d(2037, 1, 16));
    expect(step_cadence(d(2037, 1, 1), "semimonthly", 2)).toBe(d(2037, 2, 1));
    expect(step_cadence(d(2037, 1, 16), "semimonthly", 1)).toBe(d(2037, 2, 1));
    expect(step_cadence(d(2037, 1, 16), "semimonthly", -1)).toBe(d(2037, 1, 1));
  });
  it("clamps next due into [today - cadence - 7d, today + 1y] and flags it", () => {
    const today = utc_day_start(NOW);
    expect(clamp_next_due(d(1990, 1, 1), "monthly", NOW)).toEqual({ next_due_ms: today - 30 * DAY - 7 * DAY, clamped: true });
    expect(clamp_next_due(d(2100, 1, 1), "monthly", NOW)).toEqual({ next_due_ms: today + 365 * DAY, clamped: true });
    expect(clamp_next_due(d(2037, 10, 20), "monthly", NOW)).toEqual({ next_due_ms: d(2037, 10, 20), clamped: false });
  });
  it("never lets the first date reach before now - 12 months - 1 cadence", () => {
    const lo = floor_first_date(d(2030, 1, 1), "monthly", NOW);
    expect(lo).toBe(d(2036, 10, 15) - 30 * DAY);
    expect(floor_first_date(d(2037, 9, 1), "monthly", NOW)).toBe(d(2037, 9, 1));
  });
});

describe("D46: one payment per occurrence, the closest to its due date", () => {
  const floor = d(2036, 10, 15); // 12 months back
  it("a daily coffee converted monthly links exactly 12 payments", () => {
    const coffee: PaymentCandidate[] = [];
    // one a day from 2036-10-15 .. 2037-10-14
    for (let t = floor, n = 0; t < d(2037, 10, 15); t += DAY, n++) coffee.push(pay(`c${String(n).padStart(3, "0")}`, t));
    const source = coffee[coffee.length - 1];
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 14), payments: coffee, source, floor_ms: floor, now_ms: NOW,
    });
    // occurrences on the 14th of each month; those in reach of a payment: 2036-11 .. 2037-10 = 12
    expect(sel.chosen).toHaveLength(12);
    // each chosen payment is ON a due date (a coffee every day)
    for (const p of sel.chosen) expect(new Date(p.date_ms).getUTCDate()).toBe(14);
    expect(sel.excluded.length).toBe(coffee.length - 12);
    // deterministic on reruns and on input order
    const again = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 14), payments: [...coffee].reverse(), source, floor_ms: floor, now_ms: NOW,
    });
    expect(again.chosen.map((p) => p.id)).toEqual(sel.chosen.map((p) => p.id));
  });

  it("a daily coffee converted twice-a-month links 24 payments", () => {
    const coffee: PaymentCandidate[] = [];
    for (let t = floor, n = 0; t < d(2037, 10, 15); t += DAY, n++) coffee.push(pay(`c${String(n).padStart(3, "0")}`, t));
    const source = coffee[coffee.length - 1]; // Oct 14
    const sel = select_retro_payments({
      frequency: "semimonthly", next_due_ms: d(2037, 10, 29), payments: coffee, source, floor_ms: floor, now_ms: NOW,
    });
    // days 14 and 29 each month between 2036-10-15 and 2037-10-14: Oct-36(29) + Nov..Sep(2*11) + Oct-37(14) = 24
    expect(sel.chosen).toHaveLength(24);
  });

  it("a payment with no occurrence within 7 days stays a normal transaction", () => {
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 1),
      payments: [pay("a", d(2037, 9, 1)), pay("b", d(2037, 9, 15)), pay("c", d(2037, 10, 1))],
      floor_ms: floor, now_ms: NOW,
    });
    expect(sel.chosen.map((p) => p.id)).toEqual(["a", "c"]);
    expect(sel.excluded.map((p) => p.id)).toEqual(["b"]);
  });

  it("the closest payment to the due date wins; ties go to the earlier, then the smaller id", () => {
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 10),
      payments: [pay("far", d(2037, 10, 6)), pay("near", d(2037, 10, 9)), pay("tie_b", d(2037, 9, 11)), pay("tie_a", d(2037, 9, 9))],
      floor_ms: floor, now_ms: NOW,
    });
    expect(sel.chosen.map((p) => p.id)).toEqual(["tie_a", "near"]);
  });

  it("the source payment is always linked and keeps the occurrence it pays", () => {
    const source = pay("src", d(2037, 10, 5));
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 6),
      payments: [pay("better", d(2037, 10, 6)), source], source, floor_ms: floor, now_ms: NOW,
    });
    expect(sel.chosen.map((p) => p.id)).toEqual(["src"]);
    // a source out of reach of any occurrence is still linked
    const odd = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 6), payments: [], source: pay("odd", d(2037, 10, 20)), floor_ms: floor, now_ms: NOW,
    });
    expect(odd.chosen.map((p) => p.id)).toEqual(["odd"]);
    expect(odd.first_due_ms).toBeNull();
  });

  it("payments before the floor (12 months / the share date, D45) are not candidates", () => {
    const shared_from = d(2037, 9, 20);
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 1),
      payments: [pay("old", d(2037, 8, 1)), pay("pre", d(2037, 9, 1)), pay("new", d(2037, 10, 1))],
      floor_ms: shared_from, now_ms: NOW,
    });
    expect(sel.chosen.map((p) => p.id)).toEqual(["new"]);
  });
});

describe("first date", () => {
  it("is the occurrence the earliest linked payment pays (an early payment creates no unpaid month)", () => {
    // due the 15th, the earliest payment was early: Sep 10 -> pays the Sep 15 occurrence
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 15), payments: [pay("a", d(2037, 9, 10)), pay("b", d(2037, 10, 15))],
      floor_ms: d(2036, 10, 15), now_ms: NOW,
    });
    expect(compute_first_date({ frequency: "monthly", next_due_ms: d(2037, 11, 15), selection: sel, source_date_ms: d(2037, 10, 15), now_ms: NOW }))
      .toBe(d(2037, 9, 15));
  });
  it("falls back to the last occurrence at or before the source when nothing is in reach", () => {
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 11, 1), payments: [], source: pay("odd", d(2037, 10, 20)),
      floor_ms: d(2036, 10, 15), now_ms: NOW,
    });
    expect(compute_first_date({ frequency: "monthly", next_due_ms: d(2037, 11, 1), selection: sel, source_date_ms: d(2037, 10, 20), now_ms: NOW }))
      .toBe(d(2037, 10, 1));
  });
  it("is never after the next due", () => {
    const sel = select_retro_payments({
      frequency: "monthly", next_due_ms: d(2037, 10, 1), payments: [], source: pay("odd", d(2037, 10, 20)),
      floor_ms: d(2036, 10, 15), now_ms: NOW,
    });
    expect(compute_first_date({ frequency: "monthly", next_due_ms: d(2037, 10, 1), selection: sel, source_date_ms: d(2037, 10, 20), now_ms: NOW }))
      .toBeLessThanOrEqual(d(2037, 10, 1));
  });
});

describe("schedule guess", () => {
  const dates = (start: number, gap: number, n: number) => Array.from({ length: n }, (_, i) => start + i * gap * DAY);
  it("reads the median gap as a cadence and rolls the next due forward", () => {
    const g = guess_schedule(dates(d(2037, 6, 3), 30, 5), NOW)!;
    expect(g.frequency).toBe("monthly");
    expect(g.next_due_ms).toBeGreaterThanOrEqual(utc_day_start(NOW));
    expect(guess_schedule(dates(d(2037, 8, 1), 7, 8), NOW)!.frequency).toBe("weekly");
    expect(guess_schedule(dates(d(2037, 6, 1), 14, 8), NOW)!.frequency).toBe("biweekly");
    expect(guess_schedule(dates(d(2036, 6, 1), 91, 5), NOW)!.frequency).toBe("quarterly");
    expect(guess_schedule(dates(d(2034, 6, 1), 365, 3), NOW)!.frequency).toBe("yearly");
  });
  it("gives nothing for one payment or no rhythm", () => {
    expect(guess_schedule([d(2037, 6, 1)], NOW)).toBeNull();
    expect(guess_schedule([d(2037, 6, 1), d(2037, 6, 3), d(2037, 6, 4)], NOW)).toBeNull();
  });
});

describe("build_converted_recurring", () => {
  const base = {
    id: "conv_1", direction: "outflow" as const, user_id: "u1", name: "Rent", amount: 1200, frequency: "monthly" as const,
    next_due_ms: d(2037, 11, 1), first_date_ms: d(2036, 12, 1), account_id: "acc1", vendor_key: "landlord llc",
    merchant_source: "Landlord LLC", converted_from_txn_id: "plaid_t1", now_ms: NOW,
  };
  it("builds a v2 manual record with the D1 fields and the override", () => {
    const r = build_converted_recurring(base).outflow!;
    expect(r).toMatchObject({
      id: "conv_1", source: "manual", plaid_status: "MANUAL", plaid_item_id: "", account_id: "acc1", group_ids: [],
      capture_rules_version: 2, vendor_key: "landlord llc", converted_from_txn_id: "plaid_t1", merchant_name: "Landlord LLC",
      user_custom_name: "Rent", expected_amount_override: 1200, plaid_stream_id: "conv_1", transaction_ids: [],
    });
    expect(r.converted_at_ms).toBe(utc_day_start(NOW));
  });
  it("omits the key fields when there is no vendor key / source transaction (no ?? null)", () => {
    const r = build_converted_recurring({ ...base, vendor_key: null, converted_from_txn_id: null, account_id: "" }).outflow!;
    expect("vendor_key" in r).toBe(false);
    expect("converted_from_txn_id" in r).toBe(false);
  });
  it("builds income with the inflow shape", () => {
    const r = build_converted_recurring({ ...base, direction: "inflow", name: "Paycheck" }).inflow!;
    expect(r.payer_name).toBe("Landlord LLC");
    expect(r.income_type).toBe("other");
    expect(r).not.toHaveProperty("expense_type");
  });
  it("rejects bad input", () => {
    expect(build_converted_recurring({ ...base, name: "  " }).errors).toBeDefined();
    expect(build_converted_recurring({ ...base, name: "x".repeat(121) }).errors).toBeDefined();
    expect(build_converted_recurring({ ...base, amount: 0 }).errors).toBeDefined();
    expect(build_converted_recurring({ ...base, amount: CONVERT_AMOUNT_MAX + 1 }).errors).toBeDefined();
    expect(build_converted_recurring({ ...base, amount: NaN }).errors).toBeDefined();
  });
});

describe("carried convert fields (full-document writers)", () => {
  it("adds nothing to a doc that has none (byte-identical across syncs)", () => {
    expect(carried_convert_fields({}, {})).toEqual({});
    expect(carried_convert_fields(null, {})).toEqual({});
  });
  it("carries every stored field through and takes the entity's only for a NEW doc", () => {
    const existing = {
      vendorKey: "k", convertedFromTxnId: "t", convertedAtMs: 5, absorbedTxnIds: ["a"],
      absorbedStreams: [{ streamId: "s", state: "absorbed" as const, atMs: 1 }],
      mergeLog: { into: "x", atMs: 2, priorIntervals: [], inheritedName: null, inheritedOverride: null },
    };
    expect(carried_convert_fields(existing, { vendor_key: "other" })).toEqual(existing);
    expect(carried_convert_fields(null, { vendor_key: "k2", converted_from_txn_id: "t2", converted_at_ms: 9 }))
      .toEqual({ vendorKey: "k2", convertedFromTxnId: "t2", convertedAtMs: 9 });
    // an existing doc never takes the entity's values
    expect(carried_convert_fields({}, { vendor_key: "k2" })).toEqual({});
  });
});
