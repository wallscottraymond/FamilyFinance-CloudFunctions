/**
 * Review round 3 (Convert-To-Recurring Phase 1) — the planner / state / guard fixes, PURE.
 * Defects 1–6 each have a section; the emulator suites cover the same fixes end to end.
 */
import {
  CapturePlanInput,
  PlannerRecord,
  PlannerStream,
  drop_failed_saves,
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

describe("review round 3 — defect 2 (one deterministic tile per vendor)", () => {
  const early = (id: string, o: Partial<PlannerStream> = {}) =>
    stream(id, { raw_status: "EARLY_DETECTION", merchant_name: "Sunbit", description: "SUNBIT", ...o });

  it("two early streams of one vendor in any order build the identical item", () => {
    const a = early("sa", { transaction_ids: ["a1"] });
    const b = early("sb", { transaction_ids: ["b1", "b2"], account_id: "chk2" });
    const p1 = plan({ streams: [a, b] });
    const p2 = plan({ streams: [b, a] });
    expect(p1.review_items).toHaveLength(1);
    expect(p2.review_items).toEqual(p1.review_items);
    expect(p1.review_items[0].stream_id).toBe("sa"); // smallest stream id
    // Both streams' payments are held out either way.
    expect([...p1.state_change.add_suppressed!].sort()).toEqual(["a1", "b1", "b2"]);
    // Re-planned against the item it wrote → identical content (no write).
    const stored = p1.review_items[0];
    const p3 = plan({ streams: [b, a], review_items: by_id(stored) });
    expect(p3.review_items.map((i) => i.content_hash)).toEqual([stored.content_hash]);
  });

  it("the stored stream is kept while it is still in the response", () => {
    const a = early("sa");
    const b = early("sb");
    const stored = plan({ streams: [b] }).review_items[0];
    expect(stored.stream_id).toBe("sb");
    const p = plan({ streams: [a, b], review_items: by_id(stored) });
    expect(p.review_items[0].stream_id).toBe("sb");
    expect(p.review_items[0].content_hash).toBe(stored.content_hash);
    // Gone from the response → falls to the smallest remaining stream.
    expect(plan({ streams: [a], review_items: by_id(stored) }).review_items[0].stream_id).toBe("sa");
  });

  it("an open tile owned by ANOTHER Plaid item's stream is left alone (no flip-flop across items)", () => {
    const a = early("sa");
    const other = plan({ plaid_item_doc_id: "itemB", streams: [early("sx", { account_id: "chkB" })] }).review_items[0];
    expect(other.plaid_item_doc_id).toBe("itemB");
    const p = plan({ plaid_item_doc_id: "item", streams: [a], review_items: by_id(other) });
    expect(p.review_items).toEqual([]);
    expect(p.state_change.add_suppressed).toEqual(a.transaction_ids); // still held out
    // A system-closed tile from the other item (e.g. its account was removed) can be taken over.
    const closed = resolve_review_item(other, "account_removed", NOW);
    expect(plan({ streams: [a], review_items: by_id(closed) }).review_items[0]).toMatchObject({ status: "open", stream_id: "sa" });
  });

  it("a vendor whose stream matures in this sync gets only the matured close, never a fresh tile", () => {
    const e = early("sb");
    const open = plan({ streams: [e] }).review_items[0];
    const mature = stream("sa", { merchant_name: "Sunbit", description: "SUNBIT" });
    for (const order of [[mature, e], [e, mature]]) {
      const p = plan({ streams: order, review_items: by_id(open) });
      const mine = p.review_items.filter((i) => i.id === open.id);
      expect(new Set(mine.map((i) => i.status))).toEqual(new Set(["resolved"]));
      expect(mine[0].answer).toBe("matured");
    }
  });
});


describe("review round 3 — defect 3 (a failed save keeps everything that depended on it)", () => {
  it("tracked creation whose save fails: ids stay held, no item change; other direction unaffected", () => {
    const s = stream("tr", { raw_status: "EARLY_DETECTION" });
    const tracked = resolve_review_item(sugg(s), "track", NOW - 10);
    const inc: PlannerStream = { ...stream("pay"), direction: "inflow", detailed_category: "INCOME_WAGES",
      merchant_name: "Acme", description: "ACME", transaction_ids: ["pay_t1"] };
    const p = plan({ streams: [s, inc], review_items: by_id(tracked) });
    expect(p.save_outflows.map((e) => e.id)).toEqual(["tr"]);
    expect([...p.state_change.remove_suppressed!].sort()).toEqual(["pay_t1", "tr_t1", "tr_t2"]);
    const failed = drop_failed_saves(p, new Set(["outflow"]));
    expect(failed.state_change.remove_suppressed).toEqual(["pay_t1"]); // the inflow save still releases
    expect(failed.state_change.add_suppressed).toEqual([]);
    expect(drop_failed_saves(p, new Set(["outflow", "inflow"])).state_change).toEqual({ add_suppressed: [], remove_suppressed: [] });
    expect(drop_failed_saves(p, new Set())).toBe(p);
  });

  it("matured creation whose save fails: the open tile stays open, its ids stay held", () => {
    const early = stream("m", { raw_status: "EARLY_DETECTION" });
    const open = sugg(early);
    const p = plan({ streams: [stream("m")], review_items: by_id(open) });
    expect(p.review_items.map((i) => i.answer)).toEqual(["matured"]);
    const failed = drop_failed_saves(p, new Set(["outflow"]));
    expect(failed.review_items).toEqual([]);
    expect(failed.state_change.remove_suppressed).toEqual([]);
  });

  it("an id held by an unsaved stream and released by a failed save stays held", () => {
    const shared = "shared_t";
    const a = stream("a", { transaction_ids: [shared] }); // mature → created
    const b = stream("b", { raw_status: "TOMBSTONED", transaction_ids: [shared], merchant_name: "Other", description: "OTHER" });
    const p = plan({ streams: [a, b] });
    expect(p.state_change.add_suppressed).toEqual([]); // saved wins
    expect(drop_failed_saves(p, new Set(["outflow"])).state_change.add_suppressed).toEqual([shared]);
  });
});


describe("review round 3 — defect 4 (a track always gets an outcome)", () => {
  const s = stream("tr", { raw_status: "EARLY_DETECTION" });
  const tracked = resolve_review_item(sugg(s, { transaction_ids: ["tr_t1", "tr_t2"] }), "track", NOW - 10);
  const pending = { item_id: tracked.id, plaid_item_doc_id: "item", account_id: "chk", stream_id: "tr", since_ms: NOW - 10 };
  const st = state({ suppressed_txn_ids: ["tr_t1", "tr_t2"], pending_tracks: [pending] });

  it("bill created (v2) → fulfilled: pending cleared, ids released, item untouched", () => {
    const p = plan({ streams: [s], review_items: by_id(tracked), state: st });
    expect(p.save_outflows[0].capture_rules_version).toBe(2);
    expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
    expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining(["tr_t1", "tr_t2"]));
    expect(p.review_items).toEqual([]);
    // …and a failed save keeps it pending (defect 3).
    expect(drop_failed_saves(p, new Set(["outflow"])).state_change.remove_pending_track_ids).toBeUndefined();
  });

  it("saved UNSTAMPED (first seen inactive / flag off at the re-sync) → fulfilled the same way", () => {
    for (const o of [
      { streams: [{ ...s, raw_is_active: false, entity: entity("tr", { is_active: false }) }] },
      { streams: [s], flag_on: false },
    ]) {
      const p = plan({ ...o, review_items: by_id(tracked), state: st });
      expect(p.save_outflows).toHaveLength(1);
      expect(p.save_outflows[0].capture_rules_version).toBeUndefined();
      expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
      expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining(["tr_t1", "tr_t2"]));
      expect(p.review_items).toEqual([]);
    }
  });

  it("stream gone / rejected → ids released, item closed track_unavailable, pending cleared", () => {
    for (const streams of [[], [{ ...s, entity: null }]]) {
      const p = plan({ streams, review_items: by_id(tracked), state: st });
      expect(p.save_outflows).toEqual([]);
      expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
      expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining(["tr_t1", "tr_t2"]));
      expect(p.review_items).toHaveLength(1);
      expect(p.review_items[0]).toMatchObject({ id: tracked.id, status: "resolved", answer: "track_unavailable" });
      // The guard lets exactly this system write replace the user's "track".
      expect(may_background_write(tracked, tracked, p.review_items[0])).toBe(true);
    }
  });

  it("another Plaid item's pending track is left alone", () => {
    const other = state({ suppressed_txn_ids: ["tr_t1"], pending_tracks: [{ ...pending, plaid_item_doc_id: "itemB" }] });
    const p = plan({ streams: [], review_items: by_id(tracked), state: other });
    expect(p.state_change.remove_pending_track_ids).toBeUndefined();
    expect(p.review_items).toEqual([]);
  });

  it("a track_unavailable item is a system close: the vendor can be suggested again", () => {
    const closed = resolve_review_item(tracked, "track_unavailable", NOW);
    const p = plan({ streams: [s], review_items: by_id(closed) });
    expect(p.review_items[0]).toMatchObject({ id: tracked.id, status: "open" });
  });
});


describe("review round 3 — defect 5 (no \"Still a bill?\" for a bill that isn't shown)", () => {
  const still = (r: PlannerRecord): ReviewItem => make_review_item({
    user_id: U, kind: "still_a_bill", direction: "outflow", source: "plaid", status: "open", answer: null,
    subject_key: r.id, vendor_key: null, account_id: "chk", plaid_item_doc_id: "item", stream_id: r.id, record_id: r.id,
    name: r.name, amount: 10, frequency: "monthly", plaid_status: "MATURE", category: null, transaction_ids: [],
    next_due_ms: null, user_frequency: null, resolved_at_ms: null,
  }, NOW - 1000);
  const removed = [{ from_ms: NOW - 86400000, to_ms: null, mode: "going_forward" }];
  const paused = [{ from_ms: NOW - 86400000, to_ms: NOW + 30 * 86400000, mode: "paused" }];

  it("open question about a removed / paused / hidden / merged v2 bill → closed not_shown, never refreshed", () => {
    for (const o of [{ removal_intervals: removed }, { removal_intervals: paused }, { is_hidden: true }, { merged_into_id: "x" }]) {
      const r = record("b", { v2: true, plaid_is_active: false, ...o });
      const q = still(r);
      const s = stream("b", { raw_is_active: false });
      const p = plan({ streams: [s], existing: new Map([["b", r]]), review_items: by_id(q) });
      expect(p.review_items).toHaveLength(1);
      expect(p.review_items[0]).toMatchObject({ id: q.id, status: "resolved", answer: "not_shown" });
      // Plaid stopped returning it entirely (stale candidate) → the same.
      const p2 = plan({ streams: [], stale_candidates: [r], review_items: by_id(q) });
      expect(p2.review_items.map((i) => i.answer)).toEqual(["not_shown"]);
      // Once closed, nothing more is written for it.
      const closed = p.review_items[0];
      expect(plan({ streams: [s], existing: new Map([["b", r]]), review_items: by_id(closed) }).review_items).toEqual([]);
    }
  });

  it("a shown bill keeps its open question (refreshed as before)", () => {
    const r = record("b", { v2: true, plaid_is_active: false });
    const q = still(r);
    const p = plan({ streams: [stream("b", { raw_is_active: false })], existing: new Map([["b", r]]), review_items: by_id(q) });
    expect(p.review_items[0]).toMatchObject({ status: "open" });
  });
});

void [review_ids_for_sync, build_review_item_id, record, ids]; // shared helpers (used by later sections)
