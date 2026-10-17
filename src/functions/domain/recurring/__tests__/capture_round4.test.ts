/**
 * Review round 4 (Convert-To-Recurring Phase 1) — planner fixes, PURE:
 *   defect 1 — a stream maturing never closes a tile ANOTHER Plaid item's stream owns;
 *   defect 2 — a tile whose stream its owner no longer sees is let go (`stream_gone`); a track whose
 *              stream is gone checks the vendor's other streams / bills, then hands off to the
 *              user's other Plaid items before it is ever closed `track_unavailable`;
 *   test 7   — a pending track follows its STREAM (a merchant rename can't strand it) and never
 *              stays pending forever.
 * The emulator suite `phase1Round4` covers the same end to end.
 */
import {
  CapturePlanInput,
  PlannerRecord,
  PlannerStream,
  plan_recurring_capture,
  stream_vendor,
} from "../recurring_capture_planner.service";
import {
  RecurringReviewState,
  ReviewItem,
  make_review_item,
  apply_review_state_change,
  changed_items,
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

const early = (id: string, o: Partial<PlannerStream> = {}) =>
  stream(id, { raw_status: "EARLY_DETECTION", merchant_name: "Sunbit", description: "SUNBIT", ...o });

describe("round 4 — defect 1 (a matured stream never closes another item's tile)", () => {
  it("tile open + owned by item2 → item1's matured stream leaves it open; the same tile of item1 closes 'matured'", () => {
    const s2 = early("s2");
    const tile = sugg(s2, { plaid_item_doc_id: "item2" });
    const mature1 = stream("s1", { merchant_name: "Sunbit", description: "SUNBIT" });
    const p = plan({ streams: [mature1], review_items: by_id(tile) });
    expect(p.save_outflows.map((o) => o.id)).toEqual(["s1"]);
    expect(p.review_items).toEqual([]); // not closed, not rebuilt
    expect(p.state_change.remove_suppressed).not.toEqual(expect.arrayContaining(tile.transaction_ids));
    // Owned by THIS item → closed matured, as before.
    const own = sugg(s2, { plaid_item_doc_id: "item" });
    const q = plan({ streams: [mature1], review_items: by_id(own) });
    expect(q.review_items.map((i) => [i.id, i.answer])).toEqual([[own.id, "matured"]]);
  });
});

describe("round 4 — defect 2 (a tile is never owned by a stream nobody sees)", () => {
  const s2 = early("s2");
  const tile = sugg(s2); // owned by "item"

  it("owner's response no longer has the tile's stream (nor the vendor) → closed stream_gone, ids released", () => {
    const p = plan({ streams: [], review_items: by_id(tile), state: state({ suppressed_txn_ids: tile.transaction_ids }) });
    expect(p.review_items.map((i) => [i.id, i.status, i.answer])).toEqual([[tile.id, "resolved", "stream_gone"]]);
    expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining(tile.transaction_ids));
    // …a system close: another item's live stream of the vendor reopens it, owned by that item.
    const closed = p.review_items[0];
    const s1 = early("s1");
    const q = plan({ plaid_item_doc_id: "item1", streams: [s1], review_items: by_id(closed) });
    expect(q.review_items[0]).toMatchObject({ id: tile.id, status: "open", plaid_item_doc_id: "item1", stream_id: "s1" });
  });

  it("the stream is still in the response → kept; another item's tile is never let go by this item", () => {
    expect(plan({ streams: [s2], review_items: by_id(tile) }).review_items.map((i) => i.status)).toEqual(["open"]);
    const theirs = sugg(s2, { plaid_item_doc_id: "item2" });
    expect(plan({ streams: [], review_items: by_id(theirs) }).review_items).toEqual([]);
  });

  it("the owned-tile list is kept in the state, written only when it changes", () => {
    const p = plan({ streams: [s2], review_items: new Map() });
    expect(p.state_change.set_suggested_owners).toEqual({ plaid_item_doc_id: "item", item_ids: [tile.id] });
    const st = state({ suggested_owners: [{ item_id: tile.id, plaid_item_doc_id: "item" }] });
    expect(plan({ streams: [s2], review_items: by_id(tile), state: st }).state_change.set_suggested_owners).toBeUndefined();
    expect(plan({ streams: [], review_items: by_id(tile), state: st }).state_change.set_suggested_owners)
      .toEqual({ plaid_item_doc_id: "item", item_ids: [] });
  });

  describe("a track whose stream is gone", () => {
    const tracked = resolve_review_item(tile, "track", NOW - 10);
    const pending = { item_id: tracked.id, plaid_item_doc_id: "item", account_id: "chk", stream_id: "s2", since_ms: NOW - 10 };
    const st = state({ suppressed_txn_ids: tracked.transaction_ids, pending_tracks: [pending] });

    it("another stream of the vendor saved here (v2) → fulfilled by it, not closed", () => {
      const p = plan({ streams: [early("s3")], review_items: by_id(tracked), state: st });
      expect(p.save_outflows.map((o) => [o.id, o.capture_rules_version])).toEqual([["s3", 2]]);
      expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
      expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining(tracked.transaction_ids));
      expect(p.review_items.filter((i) => i.answer === "track_unavailable")).toEqual([]);
    });

    it("a v2 bill of the vendor already exists (another item made it) → fulfilled; an OLD bill never fulfils", () => {
      const v2 = record("b1", { v2: true, merchant_name: "Sunbit", description: "SUNBIT", plaid_item_id: "item1" });
      const p = plan({ streams: [], review_items: by_id(tracked), state: st, same_bill: { candidates: [v2], active_account_ids: new Set(["chk"]), inactive_loaded: false } });
      expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
      expect(p.review_items).toEqual([]);
      const old = { ...v2, v2: false };
      const q = plan({ streams: [], review_items: by_id(tracked), state: st, other_item_doc_ids: [], same_bill: { candidates: [old], active_account_ids: new Set(["chk"]), inactive_loaded: false } });
      expect(q.review_items.map((i) => i.answer)).toEqual(["track_unavailable"]);
    });

    it("nothing here → asks for the user's other items; none → track_unavailable; some → handed off (ids stay held)", () => {
      const p = plan({ streams: [], review_items: by_id(tracked), state: st });
      expect(p.wants_other_items).toBe(true);
      expect(plan({ streams: [], review_items: by_id(tracked), state: st, other_item_doc_ids: [] }).review_items.map((i) => i.answer))
        .toEqual(["track_unavailable"]);
      const h = plan({ streams: [], review_items: by_id(tracked), state: st, other_item_doc_ids: ["item1", "item"] });
      expect(h.wants_other_items).toBeUndefined();
      expect(h.review_items).toEqual([]);
      expect(h.handoff_item_doc_ids).toEqual(["item1"]);
      expect(h.state_change.remove_suppressed ?? []).not.toEqual(expect.arrayContaining(tracked.transaction_ids));
      expect(h.state_change.add_pending_tracks).toEqual([{ ...pending, plaid_item_doc_id: null, handed_off_ms: NOW, awaiting_item_doc_ids: ["item1"] }]);
    });

    it("handed off: the other item's live stream creates the bill and fulfils it; an item without the vendor stops being awaited", () => {
      const off = { ...pending, plaid_item_doc_id: null, handed_off_ms: NOW - 5, awaiting_item_doc_ids: ["item1", "item3"] };
      const st2 = state({ suppressed_txn_ids: tracked.transaction_ids, pending_tracks: [off] });
      const s1 = early("s1");
      const p = plan({ plaid_item_doc_id: "item1", streams: [s1], review_items: by_id(tracked), state: st2 });
      expect(p.save_outflows.map((o) => [o.id, o.capture_rules_version, o.user_frequency ?? null])).toEqual([["s1", 2, null]]);
      expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
      expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining([...tracked.transaction_ids, ...s1.transaction_ids]));
      // item3 has no such stream → it is no longer awaited; the last one to sync closes it.
      const q = plan({ plaid_item_doc_id: "item3", streams: [], review_items: by_id(tracked), state: st2 });
      expect(q.state_change.add_pending_tracks).toEqual([{ ...off, awaiting_item_doc_ids: ["item1"] }]);
      expect(q.review_items).toEqual([]);
      const last = state({ pending_tracks: [{ ...off, awaiting_item_doc_ids: ["item3"] }] });
      expect(plan({ plaid_item_doc_id: "item3", streams: [], review_items: by_id(tracked), state: last }).review_items.map((i) => i.answer))
        .toEqual(["track_unavailable"]);
      // …and after the hand-off TTL, whatever is still awaited.
      const stale = state({ pending_tracks: [{ ...off, handed_off_ms: NOW - 8 * 86400000 }] });
      expect(plan({ plaid_item_doc_id: "item9", streams: [], review_items: by_id(tracked), state: stale }).review_items.map((i) => i.answer))
        .toEqual(["track_unavailable"]);
    });
  });
});

describe("round 4 — test 7 (a pending track follows its stream; never pending forever)", () => {
  const s = early("tr");
  const tracked = resolve_review_item(sugg(s), "track", NOW - 10, { user_frequency: "monthly" });
  const pending = { item_id: tracked.id, plaid_item_doc_id: "item", account_id: "chk", stream_id: "tr", since_ms: NOW - 10 };
  const st = state({ suppressed_txn_ids: tracked.transaction_ids, pending_tracks: [pending] });

  it("merchant renamed (new vendor key) → the bill is still created from the tracked stream; no new tile", () => {
    const renamed = early("tr", { merchant_name: "Sunbit Inc Renamed", description: "SUNBIT INC" });
    expect(stream_vendor(renamed)).not.toBe(stream_vendor(s));
    const p = plan({ streams: [renamed], review_items: by_id(tracked), state: st });
    expect(p.save_outflows.map((o) => [o.id, o.capture_rules_version, o.user_frequency])).toEqual([["tr", 2, "monthly"]]);
    expect(p.state_change.remove_pending_track_ids).toEqual([tracked.id]);
    expect(p.state_change.remove_suppressed).toEqual(expect.arrayContaining(tracked.transaction_ids));
    expect(p.review_items.filter((i) => i.kind === "suggested" && i.status === "open")).toEqual([]);
  });

  it("a track that somehow stays pending past the max age is closed track_unavailable", () => {
    const old = state({ pending_tracks: [{ ...pending, since_ms: NOW - 31 * 86400000 }] });
    const p = plan({ streams: [], review_items: by_id(tracked), state: old, other_item_doc_ids: ["item1"] });
    expect(p.review_items.map((i) => i.answer)).toEqual(["track_unavailable"]);
    expect(p.handoff_item_doc_ids).toBeUndefined();
  });
});

describe("round 4 — state: owned tiles + handed-off tracks", () => {
  it("set_suggested_owners replaces only that item's entries; unchanged → no write", () => {
    const st = state({ suggested_owners: [{ item_id: "a", plaid_item_doc_id: "item" }, { item_id: "b", plaid_item_doc_id: "item2" }] });
    const r = apply_review_state_change(st, U, { set_suggested_owners: { plaid_item_doc_id: "item", item_ids: ["c", "c"] } });
    expect(r.changed).toBe(true);
    expect(r.suppressed_changed).toBe(false); // no derive bump
    expect(r.next.suggested_owners).toEqual([{ item_id: "b", plaid_item_doc_id: "item2" }, { item_id: "c", plaid_item_doc_id: "item" }]);
    expect(apply_review_state_change(r.next, U, { set_suggested_owners: { plaid_item_doc_id: "item", item_ids: ["c"] } }).changed).toBe(false);
  });

  it("a handed-off pending track replaces the homed one in place", () => {
    const p = { item_id: "t", plaid_item_doc_id: "item", account_id: "chk", stream_id: "s", since_ms: 1 };
    const st = state({ pending_tracks: [p] });
    const off = { ...p, plaid_item_doc_id: null, handed_off_ms: 5, awaiting_item_doc_ids: ["item2"] };
    const r = apply_review_state_change(st, U, { add_pending_tracks: [off] });
    expect(r.next.pending_tracks).toEqual([off]);
  });
});

describe("round 4 — test 8 (a >60-payment item is stable under Plaid's reordering)", () => {
  it("make_review_item sorts before it caps: a shuffled 75-id list → identical ids + hash → 0 rewrites", () => {
    const many = Array.from({ length: 75 }, (_, i) => `t${String(i).padStart(3, "0")}`);
    const s = early("big", { transaction_ids: many });
    const a = sugg(s);
    const shuffled = [...many].reverse();
    shuffled.push(shuffled.shift()!);
    const b = sugg({ ...s, transaction_ids: shuffled });
    expect(a.transaction_ids).toHaveLength(60);
    expect(b.transaction_ids).toEqual(a.transaction_ids);
    expect(b.content_hash).toBe(a.content_hash);
    // Through the planner: the stored item is not rewritten.
    const first = plan({ streams: [s] }).review_items[0];
    const again = plan({ streams: [{ ...s, transaction_ids: shuffled }], review_items: by_id(first) }).review_items;
    expect(again.map((i) => i.content_hash)).toEqual([first.content_hash]);
    expect(changed_items(again, by_id(first))).toEqual([]);
  });
});
