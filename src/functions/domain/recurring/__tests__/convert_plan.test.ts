/**
 * Convert planning (Convert-To-Recurring Phase 2): refusals, the record, which past payments link
 * (D2 / D40 / D45 / D46), the preview, the cadence alignment per schedule, and the review close.
 */
import {
  ConvertFacts,
  ConvertTxnFacts,
  build_preview,
  check_convertible,
  eligible_candidates,
  plan_convert,
  retro_floor_ms,
} from "../convert_plan.service";
import { plan_convert_review, is_own_review_item_id, suggested_item_id } from "../convert_review.service";
import { make_review_item, ReviewItem } from "../review_item.service";
import { ConvertFrequency, occurrences_between } from "../convert_recurring.service";

const DAY = 86_400_000;
const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
const NOW = Date.parse("2037-10-15T12:00:00Z");

const txn = (o: Partial<ConvertTxnFacts> = {}): ConvertTxnFacts => ({
  doc_id: "plaid_t0", plaid_id: "t0", type: "expense", account_id: "acc1", date_ms: d(2037, 10, 3), amount: 1500,
  is_pending: false, is_active: true, transfer_role: null, plaid_primary_category: "RENT_AND_UTILITIES",
  plaid_detailed_category: "RENT_AND_UTILITIES_RENT", vendor_source: "Landlord LLC", vendor_key: "landlord llc",
  splits: [{ split_id: "s0", outflow_id: null, inflow_id: null }], in_shown_stream: false, ...o,
});
const monthly_history = (n: number): ConvertTxnFacts[] =>
  Array.from({ length: n }, (_, i) => txn({
    doc_id: `plaid_h${i}`, plaid_id: `h${i}`, date_ms: d(2037, 10 - 1 - i, 3) > 0 ? Date.UTC(2037, 8 - i, 3) : 0,
    splits: [{ split_id: `hs${i}`, outflow_id: null, inflow_id: null }],
  }));
const facts = (o: Partial<ConvertFacts> = {}): ConvertFacts => ({
  user_id: "u1", txn: txn(), vendor_txns: monthly_history(5), claimed_by: null, placement: null, now_ms: NOW, ...o,
});
const req = { name: "Rent", amount: 1500, frequency: "monthly" as ConvertFrequency, next_due_date: "2037-11-03", link_past: true };

describe("check_convertible", () => {
  it("accepts a normal payment and refuses the rest with a code", () => {
    expect(check_convertible(facts())).toBeNull();
    expect(check_convertible(facts({ txn: txn({ type: "transfer" }) }))).toMatchObject({ code: "TRANSFER" });
    expect(check_convertible(facts({ txn: txn({ transfer_role: "internal" }) }))).toMatchObject({ code: "TRANSFER" });
    expect(check_convertible(facts({ txn: txn({ transfer_role: "edge_out" }) }))).toMatchObject({ code: "TRANSFER" });
    expect(check_convertible(facts({ txn: txn({ vendor_key: null }) }))).toMatchObject({ code: "NO_VENDOR" });
    expect(check_convertible(facts({ txn: txn({ account_id: "" }) }))).toMatchObject({ code: "NO_ACCOUNT" });
    expect(check_convertible(facts({ txn: txn({ is_pending: true }) }))).toMatchObject({ code: "PENDING" });
    expect(check_convertible(facts({ claimed_by: { id: "b1", name: "Rent" } }))).toMatchObject({ code: "ALREADY_TRACKED", details: { id: "b1" } });
  });
  it("refuses card-payment income (the classifier would hide it)", () => {
    const card = txn({ type: "income", amount: -300, plaid_detailed_category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
    expect(check_convertible(facts({ txn: card }))).toMatchObject({ code: "CARD_PAYMENT" });
    expect(check_convertible(facts({ txn: txn({ type: "income", amount: -300 }) }))).toBeNull();
  });
  it("refuses a pre-share source (OUT_OF_VIEW); a post-share one is fine", () => {
    const placement = { group_id: "g", shared_from_ms: d(2037, 10, 10) };
    expect(check_convertible(facts({ placement }))).toMatchObject({ code: "OUT_OF_VIEW" });
    expect(check_convertible(facts({ placement: { group_id: "g", shared_from_ms: d(2037, 9, 1) } }))).toBeNull();
    expect(check_convertible(facts({ placement: { group_id: "g", shared_from_ms: null } }))).toBeNull();
  });
});

describe("eligible_candidates + the retro floor (D40 / D45)", () => {
  it("keeps only single-split, unlinked, same-account/direction/vendor payments inside the floor", () => {
    const base = monthly_history(1)[0];
    const f = facts({
      vendor_txns: [
        base,
        { ...base, doc_id: "other_acct", account_id: "acc2" },
        { ...base, doc_id: "linked", splits: [{ split_id: "x", outflow_id: "b", inflow_id: null }] },
        { ...base, doc_id: "multi", splits: [{ split_id: "a", outflow_id: null, inflow_id: null }, { split_id: "b", outflow_id: null, inflow_id: null }] },
        { ...base, doc_id: "stream", in_shown_stream: true },
        { ...base, doc_id: "pend", is_pending: true },
        { ...base, doc_id: "gone", is_active: false },
        { ...base, doc_id: "xfer", transfer_role: "internal" },
        { ...base, doc_id: "income", type: "income" },
        { ...base, doc_id: "ancient", date_ms: d(2035, 1, 1) },
        { ...base, doc_id: "future", date_ms: NOW + 5 * DAY },
        { ...base, doc_id: "self", ...{} , },
      ],
    });
    expect(eligible_candidates(f).map((c) => c.id).sort()).toEqual([base.doc_id, "self"].sort());
  });
  it("D45: a shared account's floor is the share date", () => {
    const f = facts({ placement: { group_id: "g", shared_from_ms: d(2037, 8, 20) } });
    expect(retro_floor_ms(f)).toBe(d(2037, 8, 20));
    // Sep 3 is after the share; Aug 3 and everything earlier is before it
    expect(eligible_candidates(f).map((c) => c.id)).toEqual(["plaid_h0"]);
  });
});

describe("plan_convert", () => {
  it("plans a bill: v2 manual record on the transaction's account, the source pinned, past payments chosen", () => {
    const p = plan_convert(facts(), req, "conv_x");
    if (!p.ok) throw new Error(p.message);
    expect(p.direction).toBe("outflow");
    expect(p.entity).toMatchObject({ id: "conv_x", account_id: "acc1", vendor_key: "landlord llc", converted_from_txn_id: "plaid_t0", source: "manual" });
    expect(p.source_split_ids).toEqual(["s0"]);
    // 5 monthly payments Sep..May (3rd) + the source (Oct 3): one per occurrence
    expect(p.selection.chosen).toHaveLength(6);
    expect(p.retro_doc_ids).toHaveLength(5);
    expect(p.retro_plaid_ids).toHaveLength(5);
    expect(p.first_date_ms).toBe(Date.UTC(2037, 4, 3)); // the earliest linked payment's occurrence
  });
  it("link_past=false links only the source", () => {
    const p = plan_convert(facts(), { ...req, link_past: false }, "conv_x");
    if (!p.ok) throw new Error(p.message);
    expect(p.retro_doc_ids).toEqual([]);
    expect(p.selection.chosen.map((c) => c.id)).toEqual(["plaid_t0"]);
  });
  it("a split convert pins only that split; a whole-transaction convert pins every split", () => {
    const two = txn({ splits: [{ split_id: "a", outflow_id: null, inflow_id: null }, { split_id: "b", outflow_id: null, inflow_id: null }] });
    const one = plan_convert(facts({ txn: two }), { ...req, split_id: "b" }, "c");
    const all = plan_convert(facts({ txn: two }), req, "c");
    if (!one.ok || !all.ok) throw new Error("plan");
    expect(one.source_split_ids).toEqual(["b"]);
    expect(all.source_split_ids).toEqual(["a", "b"]);
    expect(plan_convert(facts({ txn: two }), { ...req, split_id: "nope" }, "c")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
  it("clamps a next due of 1990 / 2100 and says so; rejects a non-date", () => {
    const old = plan_convert(facts(), { ...req, next_due_date: "1990-01-01" }, "c");
    const far = plan_convert(facts(), { ...req, next_due_date: "2100-01-01" }, "c");
    if (!old.ok || !far.ok) throw new Error("plan");
    expect(old.next_due_clamped && far.next_due_clamped).toBe(true);
    expect(old.next_due_ms).toBeGreaterThan(NOW - 40 * DAY);
    expect(far.next_due_ms).toBeLessThanOrEqual(NOW + 366 * DAY);
    expect(plan_convert(facts(), { ...req, next_due_date: "2037-02-30" }, "c")).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(plan_convert(facts(), { ...req, name: "  " }, "c")).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
    expect(plan_convert(facts(), { ...req, amount: 0 }, "c")).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });
  it("income from a deposit builds an inflow", () => {
    const dep = txn({ type: "income", amount: -2000, vendor_key: "acme", vendor_source: "Acme" });
    const p = plan_convert(facts({ txn: dep, vendor_txns: [] }), req, "c");
    if (!p.ok) throw new Error(p.message);
    expect(p.direction).toBe("inflow");
    expect("payer_name" in p.entity).toBe(true);
  });

  const cadences: Array<[ConvertFrequency, number[]]> = [
    ["weekly", [7, 14, 21]], ["biweekly", [14, 28]], ["semimonthly", [15, 31]], ["monthly", [30, 61]],
    ["quarterly", [91, 182]], ["yearly", [365]],
  ];
  it.each(cadences)("cadence alignment (%s): the source and the chosen payments each sit on an occurrence; first date is the earliest", (frequency, back) => {
    const source = txn({ date_ms: d(2037, 10, 4) });
    const history = back.map((b, i) => txn({
      doc_id: `plaid_p${i}`, plaid_id: `p${i}`, date_ms: source.date_ms - b * DAY,
      splits: [{ split_id: `ps${i}`, outflow_id: null, inflow_id: null }],
    }));
    const next = frequency === "weekly" ? Date.UTC(2037, 9, 11)
      : frequency === "biweekly" ? Date.UTC(2037, 9, 18)
        : frequency === "semimonthly" ? Date.UTC(2037, 9, 19)
          : frequency === "monthly" ? Date.UTC(2037, 10, 4)
            : frequency === "quarterly" ? Date.UTC(2038, 0, 4) : Date.UTC(2038, 9, 4);
    const iso = new Date(next).toISOString().slice(0, 10);
    const p = plan_convert(facts({ txn: source, vendor_txns: history }), { ...req, frequency, next_due_date: iso }, "c");
    if (!p.ok) throw new Error(p.message);
    expect(p.first_date_ms).toBeLessThanOrEqual(source.date_ms);
    expect(p.first_date_ms).toBeLessThanOrEqual(p.next_due_ms);
    // every chosen payment is within 7 days of an occurrence of the schedule
    const dues = occurrences_between(frequency, p.next_due_ms, p.first_date_ms - 10 * DAY, p.next_due_ms);
    for (const c of p.selection.chosen) {
      expect(dues.some((due) => Math.abs(due - c.date_ms) <= 7 * DAY)).toBe(true);
    }
    // the earliest chosen payment pays the first date's occurrence
    const earliest = p.selection.chosen[0];
    expect(Math.abs(p.first_date_ms - earliest.date_ms)).toBeLessThanOrEqual(7 * DAY);
  });
});

describe("build_preview", () => {
  it("suggests name / amount / schedule and counts what would link", () => {
    const p = build_preview(facts());
    if (!p.ok) throw new Error(p.message);
    expect(p.direction).toBe("outflow");
    expect(p.suggested_name).toBe("landlord llc".length ? "Landlord LLC" : "");
    expect(p.suggested_amount).toBe(1500);
    expect(p.schedule_guess?.frequency).toBe("monthly");
    expect(p.linkable_count).toBe(5);
    expect(p.excluded_count).toBe(0);
  });
  it("gives no counts without a schedule guess; passes a refusal through", () => {
    const p = build_preview(facts({ vendor_txns: [] }));
    if (!p.ok) throw new Error(p.message);
    expect(p.schedule_guess).toBeNull();
    expect(p.linkable_count).toBeNull();
    expect(build_preview(facts({ txn: txn({ is_pending: true }) }))).toMatchObject({ ok: false, code: "PENDING" });
  });
});

describe("convert review close", () => {
  const item = (o: Partial<ReviewItem> = {}): ReviewItem => make_review_item({
    user_id: "u1", kind: "suggested", direction: "outflow", source: "plaid", status: "open", answer: null,
    subject_key: "outflow:landlord llc", vendor_key: "landlord llc", account_id: "acc1", plaid_item_doc_id: "pi", stream_id: "s",
    record_id: null, name: "Landlord", amount: 10, frequency: "monthly", plaid_status: "EARLY_DETECTION", category: null,
    transaction_ids: ["p1", "p2"], next_due_ms: null, user_frequency: null, resolved_at_ms: null, ...o,
  }, NOW);
  it("closes the vendor's open question as `converted`, releases its payments, forgets a 'Not a bill'", () => {
    const r = plan_convert_review("u1", "outflow", "landlord llc", null, item(), false, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.items.map((i) => [i.status, i.answer])).toEqual([["resolved", "converted"]]);
    expect(r.state_change.remove_suppressed).toEqual(["p1", "p2"]);
    expect(r.state_change.remove_dismissed_vendor_keys).toEqual(["outflow:landlord llc"]);
  });
  it("closes nothing already answered, and still forgets the dismissal", () => {
    const r = plan_convert_review("u1", "outflow", "landlord llc", null, item({ status: "dismissed", answer: "not_bill" }), false, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.items).toEqual([]);
    expect(r.state_change.remove_dismissed_vendor_keys).toEqual(["outflow:landlord llc"]);
  });
  it("an explicit item must be the caller's, a suggestion of the same direction and vendor", () => {
    expect(plan_convert_review("u1", "outflow", "landlord llc", item({ vendor_key: "other" }), null, true, NOW)).toMatchObject({ ok: false });
    expect(plan_convert_review("u1", "inflow", "landlord llc", item(), null, true, NOW)).toMatchObject({ ok: false });
    expect(plan_convert_review("u1", "outflow", "landlord llc", null, null, true, NOW)).toMatchObject({ ok: false });
    expect(plan_convert_review("u2", "outflow", "landlord llc", item(), null, true, NOW)).toMatchObject({ ok: false });
  });
  it("review ids: own prefix + safe characters only", () => {
    const id = suggested_item_id("u1", "outflow", "landlord llc");
    expect(is_own_review_item_id("u1", id)).toBe(true);
    expect(is_own_review_item_id("u2", id)).toBe(false);
    expect(is_own_review_item_id("u1", "u1__a/b")).toBe(false);
    expect(is_own_review_item_id("u1", "")).toBe(false);
  });
});
