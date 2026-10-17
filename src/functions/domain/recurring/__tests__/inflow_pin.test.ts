/**
 * The income pin's rules (Convert-To-Recurring Phase 2): owner, credit, view, and the split edit.
 */
import { apply_inflow_pin_to_split, plan_inflow_pin, InflowPinFacts } from "../inflow_pin.service";
import { is_split_detached_from_inflow, is_split_on_stream, splits_paying_recurring } from "../stream_membership";
import { build_split_edit } from "../../transactions/split_edit.service";
import { build_category_catalog } from "../../transactions/split_category.service";

const facts = (o: Partial<InflowPinFacts> = {}): InflowPinFacts => ({
  txn: { owner_id: "u1", type: "income", transfer_role: null, split_ids: ["s1"] },
  inflow: { owner_id: "u1", is_active: true, is_hidden: false },
  txn_view: null, inflow_view: null, ...o,
});

describe("plan_inflow_pin", () => {
  it("allows the owner's credit to the owner's income in the same view", () => {
    expect(plan_inflow_pin("u1", facts(), "s1", "i1")).toEqual({ ok: true, clear: false });
    expect(plan_inflow_pin("u1", facts({ txn_view: "g", inflow_view: "g" }), "s1", "i1")).toEqual({ ok: true, clear: false });
    expect(plan_inflow_pin("u1", facts(), "s1", null)).toEqual({ ok: true, clear: true });
  });
  it("refuses a member probing the owner's transaction or income with the same answer (no leak)", () => {
    const other_txn = plan_inflow_pin("member", facts(), "s1", "i1");
    expect(other_txn).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    const foreign = plan_inflow_pin("u1", facts({ inflow: { owner_id: "u2", is_active: true, is_hidden: false } }), "s1", "i1");
    const missing = plan_inflow_pin("u1", facts({ inflow: null }), "s1", "i1");
    expect(foreign).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(foreign).toEqual(missing);
  });
  it("refuses a debit, an edge-money transfer, an unknown split, an inactive income and another view", () => {
    expect(plan_inflow_pin("u1", facts({ txn: { owner_id: "u1", type: "expense", transfer_role: null, split_ids: ["s1"] } }), "s1", "i1"))
      .toMatchObject({ code: "NOT_AN_INCOME_PAYMENT" });
    expect(plan_inflow_pin("u1", facts({ txn: { owner_id: "u1", type: "income", transfer_role: "edge_in", split_ids: ["s1"] } }), "s1", "i1"))
      .toMatchObject({ code: "NOT_AN_INCOME_PAYMENT" });
    expect(plan_inflow_pin("u1", facts(), "nope", "i1")).toMatchObject({ code: "NOT_FOUND" });
    expect(plan_inflow_pin("u1", facts({ inflow: { owner_id: "u1", is_active: false, is_hidden: false } }), "s1", "i1")).toMatchObject({ code: "NOT_FOUND" });
    expect(plan_inflow_pin("u1", facts({ txn_view: null, inflow_view: "g" }), "s1", "i1")).toMatchObject({ code: "OUT_OF_VIEW" });
  });
});

describe("apply_inflow_pin_to_split", () => {
  it("pins, clearing the bill link and a budget pin; a remove-from-bill detach stays", () => {
    const pinned = apply_inflow_pin_to_split({ splitId: "s1", outflowId: "b", outflowAssignmentSource: "manual", budgetAssignmentSource: "manual" }, "i1");
    expect(pinned).toMatchObject({ inflowId: "i1", inflowAssignmentSource: "manual", outflowId: null, outflowAssignmentSource: "auto", budgetAssignmentSource: "category" });
    expect(apply_inflow_pin_to_split({ splitId: "s1", outflowId: null, outflowAssignmentSource: "manual" }, "i1").outflowAssignmentSource).toBe("manual");
  });
  it("clearing removes the marker (absent = auto)", () => {
    const cleared = apply_inflow_pin_to_split({ splitId: "s1", inflowId: "i1", inflowAssignmentSource: "manual" }, null);
    expect(cleared).toEqual({ splitId: "s1", inflowId: null });
    expect("inflowAssignmentSource" in cleared).toBe(false);
  });
  it("adds no key to a split that never had a pin when it is cleared", () => {
    expect(apply_inflow_pin_to_split({ splitId: "s1" }, null)).toEqual({ splitId: "s1", inflowId: null });
  });
});

describe("a manual income pin and the stream (derive / reconcile / list share these)", () => {
  const pinned_elsewhere = { splitId: "s1", inflowId: "other", inflowAssignmentSource: "manual" };
  const pinned_to_stream = { splitId: "s1", inflowId: "stream", inflowAssignmentSource: "manual" };
  it("takes the split off the stream unless the pin points to that stream", () => {
    expect(is_split_detached_from_inflow(pinned_elsewhere, "stream")).toBe(true);
    expect(is_split_on_stream(pinned_elsewhere, "inflow", "stream")).toBe(false);
    expect(is_split_detached_from_inflow(pinned_to_stream, "stream")).toBe(false);
    expect(is_split_on_stream({ splitId: "s1" }, "inflow", "stream")).toBe(true);
    // unchanged for a split with no income pin, and for an unknown stream
    expect(is_split_detached_from_inflow({ budgetAssignmentSource: "manual" })).toBe(true);
    expect(is_split_detached_from_inflow(pinned_elsewhere)).toBe(false);
  });
  it("pays the pinned income once, and the stream income does not also count it", () => {
    expect(splits_paying_recurring([pinned_elsewhere], "inflow", "other", true)).toEqual([pinned_elsewhere]);
    expect(splits_paying_recurring([pinned_elsewhere], "inflow", "stream", true)).toEqual([]);
    expect(splits_paying_recurring([pinned_to_stream], "inflow", "stream", true)).toEqual([pinned_to_stream]);
  });
});

describe("split edit: a client can never set an income pin", () => {
  const cat = build_category_catalog([]);
  const edit = (incoming: Record<string, unknown>[], stored: Record<string, unknown>[]) =>
    build_split_edit(incoming, { splits: stored }, cat, "u1", "now", (i) => `new${i}`).splits;
  it("strips a client-sent pin from an existing split and from a new one", () => {
    const stored = [{ splitId: "s1", amount: 10, inflowId: null }];
    const out = edit([{ splitId: "s1", amount: 10, inflowAssignmentSource: "manual", inflowId: "i1" }, { amount: 5, inflowAssignmentSource: "manual", inflowId: "i1" }], stored);
    expect("inflowAssignmentSource" in out[0]).toBe(false);
    expect(out[0].inflowId).toBeNull(); // engine-owned: from the stored split
    expect("inflowAssignmentSource" in out[1]).toBe(false);
    expect("inflowId" in out[1]).toBe(false);
  });
  it("keeps a stored pin through an unrelated edit; a NEW budget pin detaches it", () => {
    const stored = [{ splitId: "s1", amount: 10, inflowId: "i1", inflowAssignmentSource: "manual", budgetAssignmentSource: "category" }];
    const kept = edit([{ splitId: "s1", amount: 12 }], stored);
    expect(kept[0]).toMatchObject({ inflowId: "i1", inflowAssignmentSource: "manual" });
    const detached = edit([{ splitId: "s1", amount: 10, budgetAssignmentSource: "manual", budgetId: "b1" }], stored);
    expect(detached[0]).toMatchObject({ inflowId: null, inflowAssignmentSource: "auto" });
  });
  it("adds no income key to a split that never had one", () => {
    const out = edit([{ splitId: "s1", amount: 11 }], [{ splitId: "s1", amount: 10 }]);
    expect("inflowAssignmentSource" in out[0]).toBe(false);
  });
});
