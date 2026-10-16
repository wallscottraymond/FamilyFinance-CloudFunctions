/**
 * Review round 3 (Convert-To-Recurring Phase 1) — the planner / state / guard fixes, PURE.
 * Defects 1–6 each have a section; the emulator suites cover the same fixes end to end.
 */
import {
  CapturePlanInput,
  PlannerRecord,
  PlannerStream,
  plan_recurring_capture,
  review_ids_for_sync,
  stream_vendor,
} from "../recurring_capture_planner.service";
import {
  RecurringReviewState,
  ReviewItem,
  build_review_item_id,
  make_review_item,
  may_background_write,
  resolve_review_item,
  suggested_subject,
} from "../review_item.service";
import type { OutflowForPersistence } from "../../../integrations/plaid/plaid_recurring_transformer";

const NOW = Date.UTC(2026, 9, 15, 12);
const U = "u1";

const entity = (id: string, o: Partial<OutflowForPersistence> = {}): OutflowForPersistence => ({
  id, owner_id: U, created_by: U, updated_by: U, group_ids: [], plaid_item_id: "item", plaid_stream_id: id,
  account_id: "chk", last_amount: 10, average_amount: 10, currency: "USD", description: id.toUpperCase(),
  merchant_name: `M ${id}`, user_custom_name: null, frequency: "monthly", first_date: new Date(NOW - 9e9),
  last_date: new Date(NOW - 1e9), predicted_next_date: null, plaid_primary_category: "X",
  plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", internal_primary_category: null,
  internal_detailed_category: null, expense_type: "loan", is_essential: true, status: "pending_review",
  source: "plaid", plaid_status: "MATURE", plaid_confidence_level: null, is_active: true, is_hidden: false,
  is_user_modified: false, transaction_ids: [`${id}_t1`, `${id}_t2`], tags: [], rules: [], ...o,
});

const stream = (id: string, o: Partial<PlannerStream> = {}): PlannerStream => ({
  direction: "outflow", stream_id: id, entity: entity(id), raw_status: "MATURE", raw_frequency: "MONTHLY",
  raw_is_active: true, account_id: "chk", account_type: "depository", merchant_name: `M ${id}`,
  description: id.toUpperCase(), detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  transaction_ids: [`${id}_t1`, `${id}_t2`], average_amount: 10, predicted_next_ms: null, first_date_ms: NOW - 20 * 86400000, ...o,
});

const record = (id: string, o: Partial<PlannerRecord> = {}): PlannerRecord => ({
  id, direction: "outflow", is_active: true, is_hidden: false, v2: false, plaid_is_active: null,
  plaid_inactive_ack_ms: null, merged_into_id: null, account_id: "chk", plaid_item_id: "item", source: "plaid",
  name: `M ${id}`, merchant_name: `M ${id}`, description: id.toUpperCase(), average_amount: 10, frequency: "monthly",
  plaid_status: "MATURE", plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", first_date_ms: NOW - 9e9,
  last_date_ms: NOW - 1e9, removal_intervals: [], transaction_ids: [], ...o,
});

const input = (o: Partial<CapturePlanInput>): CapturePlanInput => ({
  user_id: U, plaid_item_doc_id: "item", now_ms: NOW, flag_on: true, streams: [], existing: new Map(),
  stale_candidates: [], review_items: new Map(), state: null, ...o,
});

const plan = (o: Partial<CapturePlanInput>) => plan_recurring_capture(input(o));
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);


const sugg = (s: PlannerStream, o: Partial<ReviewItem> = {}): ReviewItem =>
  make_review_item({
    user_id: U, kind: "suggested", direction: "outflow", source: "plaid", status: "open", answer: null,
    subject_key: suggested_subject("outflow", stream_vendor(s)), vendor_key: stream_vendor(s), account_id: "chk",
    plaid_item_doc_id: "item", stream_id: s.stream_id, record_id: null, name: "x", amount: 10, frequency: "monthly",
    plaid_status: "EARLY_DETECTION", category: null, transaction_ids: s.transaction_ids, next_due_ms: null,
    user_frequency: null, resolved_at_ms: null, ...o,
  }, NOW - 1000);
const state = (o: Partial<RecurringReviewState> = {}): RecurringReviewState => ({
  user_id: U, suppressed_txn_ids: [], dismissed_vendor_keys: [], detector_last_run_day: null, ...o,
});
const by_id = (...xs: ReviewItem[]) => new Map(xs.map((x) => [x.id, x]));

describe("review round 3 — defect 1 (answers are never reverted)", () => {
  it("may_background_write: only an unchanged, un-answered item (or a still-absent one) is written", () => {
    const s = stream("v", { raw_status: "EARLY_DETECTION" });
    const open = sugg(s);
    const answered = resolve_review_item(open, "not_bill", NOW);
    const tracked = resolve_review_item(open, "track", NOW);
    const sys = resolve_review_item(open, "matured", NOW);
    expect(may_background_write(null, undefined)).toBe(true); // brand new
    expect(may_background_write(open, open)).toBe(true); // unchanged since read
    expect(may_background_write(answered, open)).toBe(false); // answered after the read
    expect(may_background_write(tracked, open)).toBe(false);
    expect(may_background_write(answered, answered)).toBe(false); // a user's answer is never overwritten
    expect(may_background_write(sys, sys)).toBe(true); // a system close may reopen
    expect(may_background_write(open, undefined)).toBe(false); // created since the read
    expect(may_background_write(null, open)).toBe(false); // deleted since the read (purge)
    const refreshed = make_review_item({ ...open, name: "new name" }, NOW + 5, open);
    expect(may_background_write(refreshed, open)).toBe(false); // another writer changed it
  });

  it("an OPEN item for a vendor the user dismissed is closed as dismissed (it would stay forever)", () => {
    const s = stream("v", { raw_status: "EARLY_DETECTION" });
    const open = sugg(s);
    const p = plan({
      streams: [s], review_items: by_id(open),
      state: state({ dismissed_vendor_keys: [suggested_subject("outflow", stream_vendor(s))] }),
    });
    expect(p.review_items).toHaveLength(1);
    expect(p.review_items[0]).toMatchObject({ id: open.id, status: "dismissed", answer: "not_bill" });
    expect(p.state_change.add_suppressed).toEqual(s.transaction_ids);
    // Already dismissed → nothing written.
    const again = plan({ streams: [s], review_items: by_id(resolve_review_item(open, "not_bill", NOW)) });
    expect(again.review_items).toEqual([]);
  });
});
void [review_ids_for_sync, build_review_item_id, record, ids]; // shared helpers (used by later sections)
