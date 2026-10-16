import {
  CapturePlanInput,
  PlannerRecord,
  PlannerStream,
  plan_recurring_capture,
  review_ids_for_sync,
  stream_vendor,
} from "../recurring_capture_planner.service";
import {
  ReviewItem,
  build_review_item_id,
  make_review_item,
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

describe("plan_recurring_capture", () => {
  it("old records pass through exactly (flag on): saved as-is, stale-marked as today", () => {
    const s = stream("old", { raw_is_active: false, raw_status: "EARLY_DETECTION", raw_frequency: "UNKNOWN" });
    const p = plan({ streams: [s], existing: new Map([["old", record("old")]]), stale_candidates: [record("gone")] });
    expect(p.save_outflows).toEqual([s.entity]); // identical object, no v2 fields
    expect(p.stale_outflow_ids).toEqual(["gone"]);
    expect(p.review_items).toEqual([]);
    expect(p.state_change.add_suppressed).toEqual([]);
  });

  it("flag off: new streams saved as today (no stamp), whatever their status", () => {
    const streams = [stream("a", { raw_status: "EARLY_DETECTION" }), stream("b", { raw_status: "TOMBSTONED" })];
    const p = plan({ flag_on: false, streams });
    expect(p.save_outflows).toEqual(streams.map((s) => s.entity));
    expect(p.review_items).toEqual([]);
  });

  it("new mature stream → created v2 (stamped, plaid_is_active)", () => {
    const p = plan({ streams: [stream("m")] });
    expect(p.save_outflows).toHaveLength(1);
    expect(p.save_outflows[0].capture_rules_version).toBe(2);
    expect(p.save_outflows[0].plaid_is_active).toBe(true);
  });

  it("X2: a new stream first seen inactive keeps today's handling (unstamped, no question)", () => {
    const s = stream("ended", { raw_is_active: false, entity: entity("ended", { is_active: false }) });
    const p = plan({ streams: [s] });
    expect(p.save_outflows).toEqual([s.entity]);
    expect(p.save_outflows[0].capture_rules_version).toBeUndefined();
    expect(p.review_items).toEqual([]);
  });

  it("first link with 20 ended streams → 0 active bills, 0 Still a bill?", () => {
    const streams = Array.from({ length: 20 }, (_, i) =>
      stream(`e${i}`, { raw_is_active: false, entity: entity(`e${i}`, { is_active: false }) }));
    const p = plan({ streams });
    expect(p.save_outflows.filter((e) => e.is_active)).toHaveLength(0);
    expect(p.review_items.filter((i) => i.kind === "still_a_bill")).toHaveLength(0);
  });

  it("low confidence (EARLY / UNKNOWN status / UNKNOWN freq) → no record, one suggested item, ids held out", () => {
    for (const o of [{ raw_status: "EARLY_DETECTION" }, { raw_status: "UNKNOWN" }, { raw_frequency: "UNKNOWN" }]) {
      const p = plan({ streams: [stream("s", o)] });
      expect(p.save_outflows).toEqual([]);
      expect(p.review_items).toHaveLength(1);
      expect(p.review_items[0]).toMatchObject({ kind: "suggested", status: "open", source: "plaid" });
      expect(p.state_change.add_suppressed).toEqual(["s_t1", "s_t2"]);
    }
    const unknown = plan({ streams: [stream("s", { raw_frequency: "UNKNOWN" })] });
    expect(unknown.review_items[0].frequency).toBeNull(); // the user picks one (D8)
  });

  it("TOMBSTONED new → skipped, no item, held out", () => {
    const p = plan({ streams: [stream("t", { raw_status: "TOMBSTONED" })] });
    expect([p.save_outflows, p.review_items]).toEqual([[], []]);
    expect(p.state_change.add_suppressed).toEqual(["t_t1", "t_t2"]);
  });

  it("EARLY transfer stream → no tile (B-P4); income gates (X17)", () => {
    const xfer = stream("x", { raw_status: "EARLY_DETECTION", detailed_category: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
    expect(plan({ streams: [xfer] }).review_items).toEqual([]);
    const card_credit = stream("c", { direction: "inflow", raw_status: "EARLY_DETECTION", account_type: "credit",
      detailed_category: "INCOME_OTHER_INCOME" });
    expect(plan({ streams: [card_credit] }).review_items).toEqual([]);
    const pay = stream("p", { direction: "inflow", raw_status: "EARLY_DETECTION", detailed_category: "INCOME_WAGES" });
    expect(plan({ streams: [pay] }).review_items).toHaveLength(1);
  });

  it("one tile per vendor: two low-confidence streams of one vendor share one item id", () => {
    const a = stream("a", { raw_status: "EARLY_DETECTION", merchant_name: "Sunbit" });
    const b = stream("b", { raw_status: "UNKNOWN", merchant_name: "Sunbit" });
    const p = plan({ streams: [a, b] });
    expect(new Set(ids(p.review_items)).size).toBe(1);
  });

  it("vendor 'Not a bill' → never created, even when the stream matures (X14)", () => {
    const s = stream("m", { merchant_name: "Avant" });
    const state = { user_id: U, suppressed_txn_ids: [], dismissed_vendor_keys: [suggested_subject("outflow", "avant")], detector_last_run_day: null };
    const p = plan({ streams: [s], state });
    expect([p.save_outflows, p.review_items]).toEqual([[], []]);
    expect(p.state_change.add_suppressed).toEqual(["m_t1", "m_t2"]);
  });

  it("answered track (EARLY still) → created v2 with the picked schedule; ids released", () => {
    const s = stream("e", { raw_status: "EARLY_DETECTION", raw_frequency: "UNKNOWN" });
    const subject = suggested_subject("outflow", stream_vendor(s));
    const open = make_review_item({
      user_id: U, kind: "suggested", direction: "outflow", source: "plaid", status: "open", answer: null,
      subject_key: subject, vendor_key: stream_vendor(s), account_id: "chk", plaid_item_doc_id: "item", stream_id: "e",
      record_id: null, name: "x", amount: 10, frequency: null, plaid_status: "EARLY_DETECTION", category: null,
      transaction_ids: ["e_t1", "e_t2"], next_due_ms: null, user_frequency: null, resolved_at_ms: null,
    }, NOW);
    const tracked = resolve_review_item(open, "track", NOW, { user_frequency: "biweekly" });
    const p = plan({ streams: [s], review_items: new Map([[tracked.id, tracked]]) });
    expect(p.save_outflows).toHaveLength(1);
    expect(p.save_outflows[0]).toMatchObject({ capture_rules_version: 2, user_frequency: "biweekly" });
    expect(p.state_change.remove_suppressed).toEqual(["e_t1", "e_t2"]);
    expect(p.state_change.add_suppressed).toEqual([]);
  });

  it("answered track: the ITEM's held-out ids are released at creation too (not at answer time)", () => {
    const s = stream("e", { raw_status: "EARLY_DETECTION" });
    const subject = suggested_subject("outflow", stream_vendor(s));
    const open = make_review_item({
      user_id: U, kind: "suggested", direction: "outflow", source: "plaid", status: "open", answer: null,
      subject_key: subject, vendor_key: stream_vendor(s), account_id: "chk", plaid_item_doc_id: "item", stream_id: "e",
      record_id: null, name: "x", amount: 10, frequency: "monthly", plaid_status: "EARLY_DETECTION", category: null,
      // An earlier payment Plaid no longer lists in the stream is still on the item (held out).
      transaction_ids: ["e_old", "e_t1"], next_due_ms: null, user_frequency: null, resolved_at_ms: null,
    }, NOW);
    const tracked = resolve_review_item(open, "track", NOW, {});
    const p = plan({ streams: [s], review_items: new Map([[tracked.id, tracked]]) });
    expect(p.save_outflows).toHaveLength(1);
    expect([...p.state_change.remove_suppressed!].sort()).toEqual(["e_old", "e_t1", "e_t2"]);
  });

  it("an EARLY stream that matures resolves its open suggestion (matured) and is created", () => {
    const early = plan({ streams: [stream("e", { raw_status: "EARLY_DETECTION" })] });
    const item = early.review_items[0];
    const p = plan({ streams: [stream("e")], review_items: new Map([[item.id, item]]) });
    expect(p.save_outflows[0].capture_rules_version).toBe(2);
    expect(p.review_items[0]).toMatchObject({ id: item.id, status: "resolved", answer: "matured" });
  });

  describe("existing v2 records (X10)", () => {
    const v2 = (o: Partial<PlannerRecord> = {}) => record("v", { v2: true, plaid_is_active: true, ...o });

    it("always saved whatever the status; is_active stays ours; UNKNOWN freq keeps ours", () => {
      for (const o of [{ raw_status: "UNKNOWN" }, { raw_status: "TOMBSTONED" }, { raw_status: "EARLY_DETECTION" }, { raw_frequency: "UNKNOWN" }]) {
        const s = stream("v", { ...o, entity: entity("v", { frequency: "monthly", is_active: true }) });
        const p = plan({ streams: [s], existing: new Map([["v", v2({ frequency: "biweekly" })]]) });
        expect(p.save_outflows).toHaveLength(1);
        expect(p.save_outflows[0].is_active).toBe(true);
        expect(p.save_outflows[0].frequency).toBe(o.raw_frequency === "UNKNOWN" ? "biweekly" : "monthly");
        expect(p.review_items).toEqual([]);
      }
    });

    it("Plaid turns a shown v2 bill inactive → kept active + plaid_is_active=false + Still a bill? (once)", () => {
      const s = stream("v", { raw_is_active: false, entity: entity("v", { is_active: false }) });
      const p = plan({ streams: [s], existing: new Map([["v", v2()]]) });
      expect(p.save_outflows[0]).toMatchObject({ is_active: true, plaid_is_active: false });
      expect(p.review_items).toHaveLength(1);
      expect(p.review_items[0]).toMatchObject({ kind: "still_a_bill", status: "open", record_id: "v" });
      // Next sync (already plaid-inactive, item open) → the same item, unchanged content.
      const again = plan({ streams: [s], existing: new Map([["v", v2({ plaid_is_active: false })]]),
        review_items: new Map([[p.review_items[0].id, p.review_items[0]]]) });
      expect(again.review_items[0].content_hash).toBe(p.review_items[0].content_hash);
    });

    it("no question when acknowledged, hidden, removed, merged, or already answered", () => {
      const s = stream("v", { raw_is_active: false });
      const cases: Array<Partial<PlannerRecord>> = [
        { plaid_inactive_ack_ms: NOW - 1 }, { is_hidden: true }, { merged_into_id: "x" },
        { removal_intervals: [{ from_ms: NOW - 1000, to_ms: null, mode: "going_forward" }] },
      ];
      for (const c of cases) {
        expect(plan({ streams: [s], existing: new Map([["v", v2(c)]]) }).review_items).toEqual([]);
      }
    });

    it("Plaid back to active → the open question closes (auto_active)", () => {
      const off = plan({ streams: [stream("v", { raw_is_active: false })], existing: new Map([["v", v2()]]) });
      const open = off.review_items[0];
      const p = plan({ streams: [stream("v")], existing: new Map([["v", v2({ plaid_is_active: false })]]),
        review_items: new Map([[open.id, open]]) });
      expect(p.review_items[0]).toMatchObject({ status: "resolved", answer: "auto_active" });
    });

    it("rejected v2 → not saved, not stale; v2 Plaid stopped returning → plaid-inactive + question (D19)", () => {
      const rejected = stream("v", { entity: null });
      const p = plan({ streams: [rejected], existing: new Map([["v", v2()]]), stale_candidates: [v2()] });
      expect([p.save_outflows, p.stale_outflow_ids, p.plaid_inactive_outflow_ids, p.review_items]).toEqual([[], [], [], []]);
      const gone = plan({ streams: [], stale_candidates: [v2()] });
      expect(gone.stale_outflow_ids).toEqual([]);
      expect(gone.plaid_inactive_outflow_ids).toEqual(["v"]);
      expect(gone.review_items[0]).toMatchObject({ kind: "still_a_bill", record_id: "v" });
    });
  });

  it("review lookups: new streams' suggested + same-bill ids, v2 records' still-a-bill ids only", () => {
    const got = review_ids_for_sync(U, [stream("new"), stream("old"), stream("v"), stream("off", { raw_is_active: false })], [
      record("old"), record("v", { v2: true, plaid_is_active: true }), record("off", { v2: true, plaid_is_active: true }),
      record("was_off", { v2: true, plaid_is_active: false }), record("gone", { v2: true, plaid_is_active: true }),
    ]);
    expect(got.sort()).toEqual([
      build_review_item_id(U, "suggested", suggested_subject("outflow", stream_vendor(stream("new")))),
      build_review_item_id(U, "same_bill", "new"),
      build_review_item_id(U, "still_a_bill", "off"),
      build_review_item_id(U, "still_a_bill", "was_off"),
      build_review_item_id(U, "still_a_bill", "gone"),
    ].sort());
  });

  it("is deterministic", () => {
    const i = input({ streams: [stream("a", { raw_status: "EARLY_DETECTION" }), stream("b")] });
    expect(plan_recurring_capture(i)).toEqual(plan_recurring_capture(i));
  });

  it("an existing item answered by the system (account_removed) can open again", () => {
    const first = plan({ streams: [stream("e", { raw_status: "EARLY_DETECTION" })] }).review_items[0] as ReviewItem;
    const closed = resolve_review_item(first, "account_removed", NOW);
    const p = plan({ streams: [stream("e", { raw_status: "EARLY_DETECTION" })], review_items: new Map([[closed.id, closed]]) });
    expect(p.review_items[0]).toMatchObject({ status: "open", answer: null });
  });
});
