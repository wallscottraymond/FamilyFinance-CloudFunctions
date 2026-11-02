/**
 * "How often?" — an EXISTING bill / income whose Plaid stream reports frequency UNKNOWN (Code-Health-
 * Review P1-M5 follow-up, user request 2026-11-02). The record keeps its stored cadence; the user is
 * asked once; the answer is stored as `userFrequency` (kept by every later sync).
 */
import {
  plan_recurring_capture,
  review_ids_for_sync,
  CapturePlanInput,
  PlannerRecord,
  PlannerStream,
} from "../recurring_capture_planner.service";
import { build_review_item_id, ReviewItem } from "../review_item.service";
import { plan_review_answer } from "../review_answer.service";
import { OutflowForPersistence } from "../../../integrations/plaid/plaid_recurring_transformer";

const NOW = Date.UTC(2026, 10, 2);
const U = "u1";
const entity = (id: string, o: Partial<OutflowForPersistence> = {}): OutflowForPersistence => ({
  id, user_id: U, group_ids: [], is_active: true, plaid_item_id: "item", account_id: "chk", source: "plaid",
  last_amount: 98, average_amount: 98, amount_min: 98, amount_max: 98, currency: "USD", description: "AVANT",
  merchant_name: "Avant", payer_name: "Avant", user_custom_name: null, frequency: "unknown",
  first_date: new Date(NOW - 9e9), last_date: new Date(NOW - 1e9), predicted_next_date: null,
  plaid_primary_category: "LOAN_PAYMENTS", plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  internal_primary_category: null, internal_detailed_category: null, transaction_ids: ["t1", "t2"], ...o,
} as unknown as OutflowForPersistence);
const stream = (id: string, o: Partial<PlannerStream> = {}): PlannerStream => ({
  direction: "outflow", stream_id: id, entity: entity(id), raw_status: "MATURE", raw_frequency: "UNKNOWN",
  raw_is_active: true, merchant_name: "Avant", description: "AVANT", account_id: "chk",
  transaction_ids: ["t1", "t2"], average_amount: 98, predicted_next_ms: null, first_date_ms: NOW - 9e9, ...o,
} as PlannerStream);
const record = (id: string, o: Partial<PlannerRecord> = {}): PlannerRecord => ({
  id, direction: "outflow", is_active: true, is_hidden: false, v2: false, plaid_is_active: null,
  plaid_inactive_ack_ms: null, merged_into_id: null, account_id: "chk", plaid_item_id: "item", source: "plaid",
  name: "Avant", merchant_name: "Avant", description: "AVANT", average_amount: 98, frequency: "monthly",
  plaid_status: "MATURE", plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", first_date_ms: NOW - 9e9,
  last_date_ms: NOW - 1e9, removal_intervals: [], transaction_ids: [], ...o,
} as PlannerRecord);
const input = (o: Partial<CapturePlanInput>): CapturePlanInput => ({
  user_id: U, plaid_item_doc_id: "item", now_ms: NOW, flag_on: true, streams: [], existing: new Map(),
  stale_candidates: [], review_items: new Map(), state: null, ...o,
});
const how = (p: ReturnType<typeof plan_recurring_capture>) => p.review_items.filter((i) => i.kind === "how_often");

describe("How often? — planner", () => {
  for (const v2 of [false, true]) {
    it(`${v2 ? "v2" : "old"} record + Plaid UNKNOWN → one open question, prefilled with its cadence; the bill keeps it`, () => {
      const p = plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", record("avant", { v2 })]]) }));
      const [q] = how(p);
      expect(q).toMatchObject({ kind: "how_often", status: "open", record_id: "avant", frequency: "monthly", direction: "outflow" });
      expect(how(p)).toHaveLength(1);
    });
  }

  it("asked once: an existing question (open, answered or dismissed) is not re-created", () => {
    for (const status of ["open", "resolved", "dismissed"] as const) {
      const prior = { id: build_review_item_id(U, "how_often", "avant"), kind: "how_often", status } as ReviewItem;
      const p = plan_recurring_capture(input({
        streams: [stream("avant")], existing: new Map([["avant", record("avant")]]),
        review_items: new Map([[prior.id, prior]]),
      }));
      expect(how(p)).toHaveLength(0);
    }
  });

  it("not asked when the user already chose a schedule, or the bill isn't shown", () => {
    for (const r of [record("avant", { user_frequency: "yearly" }), record("avant", { removal_intervals: [{ from_ms: NOW - 86400000, to_ms: null, mode: "going_forward" }] }),
      record("avant", { merged_into_id: "x" })]) {
      expect(how(plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", r]]) })))).toHaveLength(0);
    }
  });

  it("a known Plaid frequency → no question; an open one closes by itself (matured)", () => {
    expect(how(plan_recurring_capture(input({
      streams: [stream("avant", { raw_frequency: "MONTHLY" })], existing: new Map([["avant", record("avant")]]),
    })))).toHaveLength(0);
    const open = plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", record("avant")]]) })).review_items[0];
    const p = plan_recurring_capture(input({
      streams: [stream("avant", { raw_frequency: "MONTHLY" })], existing: new Map([["avant", record("avant")]]),
      review_items: new Map([[open.id, open]]),
    }));
    expect(how(p)[0]).toMatchObject({ status: "resolved", answer: "matured" });
  });

  it("the bill is removed while the question is open → closed (not_shown)", () => {
    const open = plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", record("avant")]]) })).review_items[0];
    const p = plan_recurring_capture(input({
      streams: [stream("avant")], existing: new Map([["avant", record("avant", { removal_intervals: [{ from_ms: NOW - 86400000, to_ms: null, mode: "going_forward" }] })]]),
      review_items: new Map([[open.id, open]]),
    }));
    expect(how(p)[0]).toMatchObject({ status: "resolved", answer: "not_shown" });
  });

  it("the sync looks the question up only for UNKNOWN-frequency streams (no read per bill per sync)", () => {
    const id = build_review_item_id(U, "how_often", "avant");
    expect(review_ids_for_sync(U, [stream("avant")], [record("avant")])).toContain(id);
    expect(review_ids_for_sync(U, [stream("avant", { raw_frequency: "MONTHLY" })], [record("avant")])).not.toContain(id);
  });
});

describe("How often? — answers", () => {
  const item = plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", record("avant")]]) })).review_items[0];

  it("set_frequency stores the picked schedule on the record", () => {
    const r = plan_review_answer(item, "set_frequency", NOW, { frequency: "yearly" });
    expect(r.ok && r.plan).toMatchObject({ record_action: "set_frequency", record_frequency: "yearly" });
    expect(r.ok && r.plan.item).toMatchObject({ status: "resolved", answer: "set_frequency", user_frequency: "yearly" });
  });
  it("set_frequency needs a valid schedule", () => {
    expect(plan_review_answer(item, "set_frequency", NOW, {}).ok).toBe(false);
    expect(plan_review_answer(item, "set_frequency", NOW, { frequency: "fortnightly-ish" }).ok).toBe(false);
  });
  it("keep_frequency closes it without touching the record", () => {
    const r = plan_review_answer(item, "keep_frequency", NOW);
    expect(r.ok && r.plan).toMatchObject({ record_action: null });
    expect(r.ok && r.plan.item).toMatchObject({ status: "resolved", answer: "keep_frequency" });
  });
  it("other answers are refused; answering twice the same way is a no-op", () => {
    expect(plan_review_answer(item, "track", NOW).ok).toBe(false);
    const done = plan_review_answer(item, "keep_frequency", NOW);
    const again = plan_review_answer((done as { plan: { item: ReviewItem } }).plan.item, "keep_frequency", NOW);
    expect(again.ok && again.plan.no_op).toBe(true);
  });
});

describe("How often? — verify #1 fixes", () => {
  const base = () => plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", record("avant")]]) }));

  it("M1: the open tile is owned by its Plaid item (loaded every sync) and closes when its stream is gone", () => {
    const first = base();
    const q = first.review_items[0];
    expect(first.state_change.set_suggested_owners).toEqual({ plaid_item_doc_id: "item", item_ids: [q.id] });
    // Next sync: Plaid no longer returns the stream → the bill goes stale; the loaded tile closes.
    const p = plan_recurring_capture(input({
      streams: [], existing: new Map(), stale_candidates: [record("avant")], review_items: new Map([[q.id, q]]),
      state: { user_id: U, suppressed_txn_ids: [], dismissed_vendor_keys: [], detector_last_run_day: null,
        suggested_owners: [{ item_id: q.id, plaid_item_doc_id: "item" }] },
    }));
    expect(how(p)[0]).toMatchObject({ status: "resolved", answer: "stream_gone" });
    expect(p.state_change.set_suggested_owners).toEqual({ plaid_item_doc_id: "item", item_ids: [] });
  });

  it("L3: closed only because the bill went out of sight → asked again once it's back", () => {
    const q = base().review_items[0];
    const gone = plan_recurring_capture(input({
      streams: [stream("avant")],
      existing: new Map([["avant", record("avant", { removal_intervals: [{ from_ms: NOW - 1, to_ms: null, mode: "going_forward" }] })]]),
      review_items: new Map([[q.id, q]]),
    })).review_items.find((i) => i.kind === "how_often")!;
    expect(gone).toMatchObject({ answer: "not_shown" });
    const back = plan_recurring_capture(input({ streams: [stream("avant")], existing: new Map([["avant", record("avant")]]), review_items: new Map([[gone.id, gone]]) }));
    expect(how(back)[0]).toMatchObject({ status: "open" });
  });

  it("L6: no lookup once the user picked a schedule; L7: no question while Plaid has it off", () => {
    const id = build_review_item_id(U, "how_often", "avant");
    expect(review_ids_for_sync(U, [stream("avant")], [record("avant", { user_frequency: "yearly" })])).not.toContain(id);
    for (const o of [{ raw_is_active: false }, { raw_status: "TOMBSTONED" }]) {
      expect(how(plan_recurring_capture(input({ streams: [stream("avant", o)], existing: new Map([["avant", record("avant")]]) })))).toHaveLength(0);
    }
  });
});
