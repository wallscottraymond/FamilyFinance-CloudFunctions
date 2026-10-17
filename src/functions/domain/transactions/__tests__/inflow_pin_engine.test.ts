/**
 * Manual income pin in the assignment engine (Convert-To-Recurring Phase 2):
 * preserved for the caller's own income in view, beats the recurring matcher, dropped for anything
 * else, never for a debit, detached by a budget pin, kept on edge money, and change detection sees it.
 */
import {
  compute_transaction_assignment,
  AssignmentContext,
  SplitForAssignment,
} from "../compute_transaction_assignment.service";
import { build_category_catalog, CategoryDocForCatalog } from "../split_category.service";
import { merge_assignment_onto_raw_splits } from "../../../orchestrators/transactions/merge_assignment";

const DOCS: CategoryDocForCatalog[] = [
  { id: "INCOME_WAGES", data: { overallCategoryId: "income", firstCategoryId: "paycheck" } },
  { id: "OTHER_EXPENSE", data: { overallCategoryId: "other", firstCategoryId: "other" } },
];
const EE = "ee";
const ctx = (over: Partial<AssignmentContext> = {}): AssignmentContext => ({
  txn_date_ms: Date.UTC(2026, 5, 15), txn_merchant_name: null, txn_name: null, txn_is_income: true,
  real_budgets: [], everything_else_budget_ids: { monthly: EE, weekly: EE, bi_monthly: EE },
  category_catalog: build_category_catalog(DOCS), source_periods: [], recurring_by_split: {},
  active_inflow_ids: new Set(["mine", "stream"]), suppressed_inflow_ids: new Set(["paused"]), ...over,
});
const split = (over: Partial<SplitForAssignment> = {}): SplitForAssignment => ({
  split_id: "s1", budget_id: "unset", budget_assignment_source: "category", plaid_match_category: "INCOME_WAGES",
  outflow_id: null, inflow_id: "mine", inflow_source: "manual", monthly_period_id: null, weekly_period_id: null,
  bi_weekly_period_id: null, ...over,
});

describe("manual income pin", () => {
  it("is preserved and beats the recurring matcher's stream", () => {
    const r = compute_transaction_assignment([split()], ctx({ recurring_by_split: { s1: { outflow_id: null, inflow_id: "stream" } } }));
    expect(r.splits[0]).toMatchObject({ inflow_id: "mine", inflow_source: "manual" });
    expect(r.splits[0].reason.recurring).toBe("inflow");
  });
  it("without a pin the matcher's link is used and the source stays auto", () => {
    const r = compute_transaction_assignment([split({ inflow_id: null, inflow_source: undefined })],
      ctx({ recurring_by_split: { s1: { outflow_id: null, inflow_id: "stream" } } }));
    expect(r.splits[0]).toMatchObject({ inflow_id: "stream", inflow_source: "auto" });
  });
  it("a pin to an income the caller doesn't own / isn't in this view is dropped (falls back to auto)", () => {
    const r = compute_transaction_assignment([split({ inflow_id: "someone_elses" })], ctx());
    expect(r.splits[0]).toMatchObject({ inflow_id: null, inflow_source: "auto" });
    const none = compute_transaction_assignment([split()], ctx({ active_inflow_ids: undefined, suppressed_inflow_ids: undefined }));
    expect(none.splits[0].inflow_source).toBe("auto"); // deny by default
  });
  it("an income removed / paused for the month keeps its pin as stored", () => {
    const r = compute_transaction_assignment([split({ inflow_id: "paused" })], ctx());
    expect(r.splits[0]).toMatchObject({ inflow_id: "paused", inflow_source: "manual" });
  });
  it("never pins a debit", () => {
    const r = compute_transaction_assignment([split({ plaid_match_category: "OTHER_EXPENSE" })], ctx({ txn_is_income: false }));
    expect(r.splits[0]).toMatchObject({ inflow_id: null, inflow_source: "auto" });
  });
  it("a budget pin detaches the income pin", () => {
    const r = compute_transaction_assignment(
      [split({ budget_assignment_source: "manual", budget_id: EE })], ctx());
    expect(r.splits[0]).toMatchObject({ inflow_id: null, inflow_source: "auto" });
  });
  it("clears the split's bill link (a deposit is not a bill payment) but keeps a remove-from-bill detach", () => {
    const a = compute_transaction_assignment([split({ outflow_id: "bill", outflow_source: "auto" })],
      ctx({ recurring_by_split: { s1: { outflow_id: "bill", inflow_id: null } } }));
    expect(a.splits[0].outflow_id).toBeNull();
    const d = compute_transaction_assignment([split({ outflow_id: null, outflow_source: "manual" })], ctx());
    expect(d.splits[0]).toMatchObject({ outflow_id: null, outflow_source: "manual", inflow_id: "mine" });
  });
  it("edge money keeps the pin as stored (readers drop every link on edge money)", () => {
    const r = compute_transaction_assignment([split()], ctx({ txn_transfer_role: "edge_in" }));
    expect(r.splits[0]).toMatchObject({ inflow_id: "mine", inflow_source: "manual", outflow_id: null });
  });
  it("change detection: an unchanged pinned split is unchanged; adding / losing a pin is a change", () => {
    const first = compute_transaction_assignment([split()], ctx());
    const s = first.splits[0];
    const stored = split({
      monthly_budget_id: s.monthly_budget_id, weekly_budget_id: s.weekly_budget_id, bi_weekly_budget_id: s.bi_weekly_budget_id,
      budget_id: s.budget_id, monthly_period_id: s.monthly_period_id, weekly_period_id: s.weekly_period_id,
      bi_weekly_period_id: s.bi_weekly_period_id, overall_category_id: s.overall_category_id,
      first_category_id: s.first_category_id, second_category_id: s.second_category_id, category_source: s.category_source,
      budget_assignment_source: s.budget_assignment_source,
    });
    expect(compute_transaction_assignment([stored], ctx()).changed).toBe(false);
    expect(compute_transaction_assignment([{ ...stored, inflow_source: undefined, inflow_id: "mine" }], ctx()).changed).toBe(true);
  });
});

describe("merge_assignment: the source key is written only when manual or already stored", () => {
  const resolved = (raw: Record<string, unknown>) => ({
    transaction_doc_id: "t", raw_splits: [raw], splits_input: [], context: {} as AssignmentContext, budget_names: {},
  });
  const result = (source: "auto" | "manual") => ({
    splits: [{ split_id: "s1", monthly_budget_id: "u", weekly_budget_id: "u", bi_weekly_budget_id: "u",
      budget_assignment_source: "category" as const, budget_id: "u", outflow_id: null, outflow_source: "auto" as const,
      suspended_outflow_pin: null, inflow_id: "mine", inflow_source: source, monthly_period_id: null, weekly_period_id: null,
      bi_weekly_period_id: null, overall_category_id: null, first_category_id: null, second_category_id: null,
      category_source: "plaid" as const, reason: { budget: "income_excluded" as const, tie: false, recurring: "inflow" as const } }],
    touched_budget_ids: [], touched_outflow_ids: [], touched_inflow_ids: [], changed: true, any_unassigned: false,
  });
  const now = { toMillis: () => 1 } as never;
  it("auto + never stored → no key (byte-identical for every existing split)", () => {
    const m = merge_assignment_onto_raw_splits(resolved({ splitId: "s1" }), result("auto"), now);
    expect("inflowAssignmentSource" in m.updated_splits[0]).toBe(false);
  });
  it("manual → written; already stored → kept in step", () => {
    expect(merge_assignment_onto_raw_splits(resolved({ splitId: "s1" }), result("manual"), now).updated_splits[0].inflowAssignmentSource).toBe("manual");
    expect(merge_assignment_onto_raw_splits(resolved({ splitId: "s1", inflowAssignmentSource: "manual" }), result("auto"), now)
      .updated_splits[0].inflowAssignmentSource).toBe("auto");
  });
});
