/**
 * "Mark as paid / received" — the ONE shared rule (domain/recurring/manual_settlement), as the
 * period page applies it (apply_manual_settlements after reconcile) AND as the stored reconcile
 * applies it (compute_period_reconciliation's marks): a real payment always wins; an unpaid
 * occurrence with a mark is settled manually by the mark's amount.
 */
import {
  apply_manual_settlements,
  manual_settlement_amount,
  occurrence_date_key,
  parse_occurrence_date_key,
  ManualSettledOccurrences,
} from "../manual_settlement.service";
import {
  reconcile_occurrences,
  reconcile_income_occurrences,
  ExpectedOccurrence,
} from "../reconcile_occurrences.service";
import { place_occurrences } from "../occurrence_placement.service";
import { compute_period_reconciliation } from "../period_reconciliation.service";
import { fingerprint_result, fingerprint_stored } from "../reconciliation_fingerprint";

const D = (iso: string): number => Date.parse(`${iso}T00:00:00.000Z`);
const mark = (amount: number) => ({ amount, marked_at_ms: 1, marked_by: "u1" });
const occ = (iso: string, amount = 50): ExpectedOccurrence => ({
  occurrence_id: `b_${iso}`, recurring_id: "b", due_date_ms: D(iso), amount_due: amount,
});
const AUG = { period_id: "2026M08", start_ms: D("2026-08-01"), end_ms: D("2026-08-31") + 86_399_999 };

describe("occurrence date keys", () => {
  it("keys an occurrence by its UTC due date and parses only real dates", () => {
    expect(occurrence_date_key(Date.parse("2026-08-15T23:30:00Z"))).toBe("2026-08-15");
    expect(parse_occurrence_date_key("2026-08-15")).toBe(D("2026-08-15"));
    expect(parse_occurrence_date_key("2026-02-30")).toBeNull();
    expect(parse_occurrence_date_key("2026-8-1")).toBeNull();
  });
});

describe("manual_settlement_amount (the rule for one occurrence)", () => {
  const marks: ManualSettledOccurrences = { "2026-08-15": mark(40) };
  it("a mark settles an occurrence no real payment settled, by the mark's amount", () => {
    expect(manual_settlement_amount(D("2026-08-15"), false, marks)).toBe(40);
  });
  it("a real payment wins: the mark is ignored", () => {
    expect(manual_settlement_amount(D("2026-08-15"), true, marks)).toBeNull();
  });
  it("no mark for that due date → not manual", () => {
    expect(manual_settlement_amount(D("2026-08-16"), false, marks)).toBeNull();
    expect(manual_settlement_amount(D("2026-08-15"), false, undefined)).toBeNull();
  });
});

describe("period page: apply_manual_settlements after reconcile", () => {
  it("a marked monthly bill with no transaction → paid, amount = mark, flagged manual", () => {
    const reconciled = reconcile_occurrences([occ("2026-08-15", 50)], []);
    const [g] = place_occurrences(
      apply_manual_settlements(reconciled, { "2026-08-15": mark(50) }), [AUG]
    );
    expect(g).toMatchObject({ count_paid: 1, total_paid: 50, total_due: 50, status: "paid" });
    expect(g.occurrences).toEqual([{ due_ms: D("2026-08-15"), paid: true, amount: 50, manual: true }]);
  });

  it("a real payment for a marked occurrence pays it ONCE, by the transaction (not doubled)", () => {
    const reconciled = reconcile_occurrences(
      [occ("2026-08-15", 50)],
      [{ transaction_id: "t1", split_id: "s1", date_ms: D("2026-08-16"), amount: 47 }]
    );
    const [g] = place_occurrences(
      apply_manual_settlements(reconciled, { "2026-08-15": mark(50) }), [AUG]
    );
    expect(g).toMatchObject({ count_paid: 1, total_paid: 47 });
    expect(g.occurrences[0].manual).toBeUndefined();
  });

  it("weekly bill: marking ONE occurrence of several settles only that one", () => {
    const expected = ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"].map((d) => occ(d, 20));
    const settled = apply_manual_settlements(
      reconcile_occurrences(expected, []), { "2026-08-12": mark(20) }
    );
    const [g] = place_occurrences(settled, [AUG]);
    expect(g).toMatchObject({ count_in_period: 4, count_paid: 1, total_paid: 20, status: "partial" });
    expect(g.occurrences.filter((o) => o.manual).map((o) => o.due_ms)).toEqual([D("2026-08-12")]);
  });

  it("income: a marked occurrence counts as received; a deposit-matched one stays the deposit's", () => {
    const expected = [occ("2026-08-15", 1000), occ("2026-08-31", 1000)];
    const reconciled = reconcile_income_occurrences(
      "b",
      [{ transaction_id: "d1", split_id: null, date_ms: D("2026-08-15"), amount: 990 }],
      expected,
      AUG.start_ms,
      AUG.end_ms
    );
    const marks = { "2026-08-15": mark(1000), "2026-08-31": mark(1000) };
    const [g] = place_occurrences(apply_manual_settlements(reconciled, marks), [AUG]);
    expect(g).toMatchObject({ count_paid: 2, total_paid: 1990, status: "paid" });
  });

  it("no marks → output unchanged (no `manual` key anywhere)", () => {
    const reconciled = reconcile_occurrences([occ("2026-08-15")], []);
    expect(apply_manual_settlements(reconciled, {})).toBe(reconciled);
    expect(place_occurrences(reconciled, [AUG])[0].occurrences[0]).not.toHaveProperty("manual");
  });
});

describe("stored reconcile: compute_period_reconciliation with marks", () => {
  const monthly = {
    period_id: "p", start_ms: AUG.start_ms, end_ms: AUG.end_ms, is_variable_amount: false,
    amount_per_occurrence: 50, occurrence_due_dates_ms: [D("2026-08-15")],
  };
  it("a marked occurrence with no payment → complete, counted paid = the mark", () => {
    const r = compute_period_reconciliation(monthly, [], { "2026-08-15": mark(50) });
    expect(r).toMatchObject({
      status: "complete", occurrences_paid: 1, manual_amount: 50, matched_amount: 0,
    });
    expect(r.occurrences[0]).toMatchObject({ paid: true, manual: true, amount: 50, transaction_id: null });
  });

  it("unmarked → none (agrees with the page)", () => {
    const r = compute_period_reconciliation(monthly, [], {});
    expect(r).toMatchObject({ status: "none", occurrences_paid: 0, manual_amount: 0 });
  });

  it("a real payment on a marked occurrence wins (mark ignored, never doubled)", () => {
    const r = compute_period_reconciliation(
      monthly,
      [{ transaction_id: "t1", split_id: "s", amount: 50, is_pending: false, date_ms: D("2026-08-16") }],
      { "2026-08-15": mark(50) }
    );
    expect(r).toMatchObject({ status: "complete", matched_amount: 50, manual_amount: 0 });
    expect(r.occurrences[0]).toMatchObject({ manual: false, transaction_id: "t1" });
  });

  it("weekly: one marked of four → partial, 1 paid", () => {
    const weekly = {
      ...monthly,
      amount_per_occurrence: 20,
      occurrence_due_dates_ms: ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"].map(D),
    };
    const r = compute_period_reconciliation(weekly, [], { "2026-08-12": mark(20) });
    expect(r).toMatchObject({ status: "partial", occurrences_paid: 1, manual_amount: 20 });
  });
});

describe("fingerprint covers marks without rewriting unmarked periods", () => {
  const period = {
    period_id: "p", start_ms: AUG.start_ms, end_ms: AUG.end_ms, is_variable_amount: false,
    amount_per_occurrence: 50, occurrence_due_dates_ms: [D("2026-08-15")],
  };
  /* eslint-disable @typescript-eslint/naming-convention */
  const stored_without_manual_fields = {
    status: "none", matchedAmount: 0, pendingAmount: 0, expectedAmount: 50,
    occurrencesExpected: 1, occurrencesPaid: 0, hasPending: false,
    occurrences: [{ dueDate: D("2026-08-15"), paid: false, pending: false, transactionId: null, amount: null }],
    matchedSplits: [],
  };
  /* eslint-enable @typescript-eslint/naming-convention */
  it("an unmarked result equals a pre-feature stored doc (no mass rewrite)", () => {
    expect(fingerprint_result(compute_period_reconciliation(period, []))).toBe(
      fingerprint_stored(stored_without_manual_fields)
    );
  });
  it("a mark changes the fingerprint (the period IS rewritten)", () => {
    expect(
      fingerprint_result(compute_period_reconciliation(period, [], { "2026-08-15": mark(50) }))
    ).not.toBe(fingerprint_stored(stored_without_manual_fields));
  });
});
