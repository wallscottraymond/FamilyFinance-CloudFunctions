import { find_replaced_record, has_stopped } from "../same_bill.service";
import { plan_recurring_capture, PlannerRecord, PlannerStream } from "../recurring_capture_planner.service";
import type { OutflowForPersistence } from "../../../integrations/plaid/plaid_recurring_transformer";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 15);
const rec = (id: string, o: Partial<PlannerRecord> = {}): PlannerRecord => ({
  id, direction: "outflow", is_active: false, is_hidden: false, v2: false, plaid_is_active: null,
  plaid_inactive_ack_ms: null, merged_into_id: null, account_id: "chk", plaid_item_id: "item", source: "plaid",
  name: "Sunbit", merchant_name: "Sunbit", description: "SUNBIT", average_amount: 50, frequency: "monthly",
  plaid_status: "STALE", plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  first_date_ms: NOW - 300 * DAY, last_date_ms: NOW - 40 * DAY, removal_intervals: [], transaction_ids: [], ...o,
});
const entity = (id: string): OutflowForPersistence => ({
  id, owner_id: "u", created_by: "u", updated_by: "u", group_ids: [], plaid_item_id: "item", plaid_stream_id: id,
  account_id: "chk", last_amount: 60, average_amount: 60, currency: "USD", description: "SUNBIT", merchant_name: "Sunbit",
  user_custom_name: null, frequency: "monthly", first_date: new Date(NOW - 35 * DAY), last_date: new Date(NOW - 5 * DAY),
  predicted_next_date: null, plaid_primary_category: "LOAN_PAYMENTS", plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  internal_primary_category: null, internal_detailed_category: null, expense_type: "loan", is_essential: true,
  status: "pending_review", source: "plaid", plaid_status: "MATURE", plaid_confidence_level: null, is_active: true,
  is_hidden: false, is_user_modified: false, transaction_ids: [`${id}_t1`], tags: [], rules: [],
});
const stream = (id: string, o: Partial<PlannerStream> = {}): PlannerStream => ({
  direction: "outflow", stream_id: id, entity: entity(id), raw_status: "MATURE", raw_frequency: "MONTHLY",
  raw_is_active: true, account_id: "chk", account_type: "depository", merchant_name: "Sunbit", description: "SUNBIT",
  detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", transaction_ids: [`${id}_t1`], average_amount: 60,
  predicted_next_ms: null, first_date_ms: NOW - 35 * DAY, ...o,
});
const ctx = { active_account_ids: new Set(["chk"]), stopped_in_sync: new Set<string>() };

describe("same bill (replacement only)", () => {
  it("a new stream after a stopped bill of the same vendor matches", () => {
    expect(find_replaced_record(stream("new"), "sunbit", [rec("old")], ctx)?.id).toBe("old");
  });

  it("two ACTIVE streams of one vendor never match (Shellpoint, paid twice a month)", () => {
    const active = rec("old", { is_active: true, plaid_status: "MATURE" });
    expect(find_replaced_record(stream("new"), "sunbit", [active], ctx)).toBeNull();
    // …unless this very sync reports the old one inactive / gone.
    expect(find_replaced_record(stream("new"), "sunbit", [active], { ...ctx, stopped_in_sync: new Set(["old"]) })?.id).toBe("old");
  });

  it("an account-removal soft delete is not 'stopped'; merged records never match", () => {
    expect(has_stopped(rec("old", { account_id: "removed" }), ctx)).toBe(false);
    expect(has_stopped(rec("old", { merged_into_id: "x" }), ctx)).toBe(false);
    expect(has_stopped(rec("old", { is_active: true, v2: true, plaid_is_active: false }), ctx)).toBe(true);
  });

  it("timing: new must start around/after the old's last payment, not long after", () => {
    expect(find_replaced_record(stream("new", { first_date_ms: NOW - 80 * DAY }), "sunbit", [rec("old")], ctx)).toBeNull();
    expect(find_replaced_record(stream("new", { first_date_ms: NOW - 45 * DAY }), "sunbit", [rec("old")], ctx)?.id).toBe("old");
    expect(find_replaced_record(stream("new"), "sunbit", [rec("old", { last_date_ms: NOW - 200 * DAY })], ctx)).toBeNull();
  });

  it("different vendor / direction → no match; most recently stopped wins", () => {
    expect(find_replaced_record(stream("new"), "sunbit", [rec("o", { merchant_name: "Avant", description: "AVANT" })], ctx)).toBeNull();
    expect(find_replaced_record(stream("new"), "sunbit", [rec("o", { direction: "inflow" })], ctx)).toBeNull();
    const a = rec("a", { last_date_ms: NOW - 60 * DAY });
    const b = rec("b", { last_date_ms: NOW - 40 * DAY });
    expect(find_replaced_record(stream("new"), "sunbit", [a, b], ctx)?.id).toBe("b");
  });

  it("planner: held as Same bill? (no record, ids held out); asks for inactive records when none loaded", () => {
    const base = { user_id: "u", plaid_item_doc_id: "item", now_ms: NOW, flag_on: true, existing: new Map(),
      stale_candidates: [], review_items: new Map(), state: null };
    const held = plan_recurring_capture({ ...base, streams: [stream("new")],
      same_bill: { candidates: [rec("old")], active_account_ids: new Set(["chk"]), inactive_loaded: true } });
    expect(held.save_outflows).toEqual([]);
    expect(held.review_items[0]).toMatchObject({ kind: "same_bill", record_id: "old", stream_id: "new", name: "Sunbit", status: "open" });
    expect(held.state_change.add_suppressed).toEqual(["new_t1"]);
    const lazy = plan_recurring_capture({ ...base, streams: [stream("new")],
      same_bill: { candidates: [], active_account_ids: new Set(["chk"]), inactive_loaded: false } });
    expect(lazy.wants_inactive_records).toBe(true);
    expect(lazy.save_outflows).toHaveLength(1);
    const loaded = plan_recurring_capture({ ...base, streams: [stream("new")],
      same_bill: { candidates: [], active_account_ids: new Set(["chk"]), inactive_loaded: true } });
    expect(loaded.wants_inactive_records).toBeUndefined();
  });
});
