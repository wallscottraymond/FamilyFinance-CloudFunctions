/**
 * Absorb + merge rules (Convert-To-Recurring D3 / D7 / D22 / D41 / D42) — pure.
 */
import { can_absorb, decline_absorbed_stream, find_absorber, plan_absorb } from "../absorb.service";
import type { PlannerRecord, PlannerStream } from "../recurring_capture_planner.service";
import type { AbsorbedStream } from "../convert_recurring.service";

const DAY = 86_400_000;
const rec = (o: Partial<PlannerRecord> = {}): PlannerRecord => ({
  id: "conv_1", direction: "outflow", is_active: true, is_hidden: false, v2: true, plaid_is_active: true, plaid_inactive_ack_ms: null,
  merged_into_id: null, account_id: "acc1", plaid_item_id: "", source: "manual", name: "Rent", merchant_name: "Landlord LLC",
  description: "Rent", average_amount: 1500, frequency: "monthly", plaid_status: "MANUAL", plaid_detailed_category: "X",
  first_date_ms: 0, last_date_ms: 0, removal_intervals: [], transaction_ids: [], vendor_key: "landlord llc",
  expected_amount_override: 1500, ...o,
});
const stream = (o: Partial<PlannerStream> = {}): PlannerStream => ({
  direction: "outflow", stream_id: "s1", entity: null, raw_status: "MATURE", raw_frequency: "MONTHLY", raw_is_active: true,
  account_id: "acc1", account_type: null, merchant_name: "Landlord LLC", description: "LANDLORD", detailed_category: "",
  transaction_ids: ["b", "a"], average_amount: 1490, predicted_next_ms: null, first_date_ms: 0, ...o,
});

describe("find_absorber", () => {
  it("needs v2 + manual + key + account, shown, not merged; same direction + account + vendor", () => {
    expect(can_absorb(rec())).toBe(true);
    for (const bad of [{ v2: false }, { source: "plaid" }, { vendor_key: null }, { account_id: "" }, { is_active: false }, { is_hidden: true }, { merged_into_id: "x" }]) {
      expect(can_absorb(rec(bad as Partial<PlannerRecord>))).toBe(false);
    }
    expect(find_absorber(stream(), "landlord llc", [rec()])?.id).toBe("conv_1");
    expect(find_absorber(stream({ account_id: "acc2" }), "landlord llc", [rec()])).toBeNull();
    expect(find_absorber(stream({ direction: "inflow" }), "landlord llc", [rec()])).toBeNull();
    expect(find_absorber(stream(), "somebody else", [rec()])).toBeNull();
  });
  it("two bills of one vendor: the closest amount, then the smallest id", () => {
    const a = rec({ id: "a", expected_amount_override: 10 });
    const b = rec({ id: "b", expected_amount_override: 1480 });
    expect(find_absorber(stream(), "landlord llc", [a, b])?.id).toBe("b");
    expect(find_absorber(stream({ average_amount: 10 }), "landlord llc", [b, a])?.id).toBe("a");
    expect(find_absorber(stream({ average_amount: 745 }), "landlord llc", [rec({ id: "z", expected_amount_override: 1 }), rec({ id: "y", expected_amount_override: 1489 })])?.id).toBe("y");
  });
});

describe("plan_absorb", () => {
  const inr = new Set(["s1"]);
  it("records the stream and its payments, sorted; never Plaid's numbers", () => {
    const w = plan_absorb(rec(), stream(), 5, inr, undefined);
    if (!w || w === "declined" || w === "full") throw new Error("expected a write");
    expect(w.streams).toEqual([{ stream_id: "s1", state: "absorbed", at_ms: 5, txn_ids: ["a", "b"] }]);
    expect(w.txn_ids).toEqual(["a", "b"]);
    expect(w.added_txn_ids).toEqual(["a", "b"]);
  });
  it("an already absorbed stream with nothing new is no write; growth writes only the new ids", () => {
    const have: AbsorbedStream[] = [{ stream_id: "s1", state: "absorbed", at_ms: 1, txn_ids: ["a", "b"] }];
    expect(plan_absorb(rec({ absorbed_streams: have, absorbed_txn_ids: ["a", "b"] }), stream(), 9, inr, undefined)).toBeNull();
    const w = plan_absorb(rec({ absorbed_streams: have }), stream({ transaction_ids: ["a", "b", "c"] }), 9, inr, undefined);
    if (!w || w === "declined" || w === "full") throw new Error("expected growth");
    expect(w.added_txn_ids).toEqual(["c"]);
    expect(w.streams[0].at_ms).toBe(1); // no timestamp refresh
  });
  it("a declined stream is not absorbed again", () => {
    const have: AbsorbedStream[] = [{ stream_id: "s1", state: "declined", at_ms: 1, txn_ids: [] }];
    expect(plan_absorb(rec({ absorbed_streams: have }), stream(), 9, inr, undefined)).toBe("declined");
  });
  it("the list is bounded: a stream still in the response is never evicted, a gone one is", () => {
    const twenty: AbsorbedStream[] = Array.from({ length: 20 }, (_, i) => ({ stream_id: `old${i}`, state: "absorbed" as const, at_ms: i, txn_ids: [`t${i}`] }));
    expect(plan_absorb(rec({ absorbed_streams: twenty }), stream({ stream_id: "new" }), 99, new Set(["new", ...twenty.map((s) => s.stream_id)]), undefined)).toBe("full");
    const w = plan_absorb(rec({ absorbed_streams: twenty }), stream({ stream_id: "new" }), 99, new Set(["new"]), undefined);
    if (!w || w === "declined" || w === "full") throw new Error("expected eviction");
    expect(w.streams).toHaveLength(20);
    expect(w.streams.some((s) => s.stream_id === "old0")).toBe(false); // the oldest gone one
  });
  it("decline drops the stream's payments from the claimed set", () => {
    const have: AbsorbedStream[] = [
      { stream_id: "s1", state: "absorbed", at_ms: 1, txn_ids: ["a", "b"] },
      { stream_id: "s2", state: "absorbed", at_ms: 2, txn_ids: ["c"] },
    ];
    const d = decline_absorbed_stream(have, "s1", 7)!;
    expect(d.txn_ids).toEqual(["c"]);
    expect(d.streams[0]).toMatchObject({ state: "declined", txn_ids: [] });
    expect(decline_absorbed_stream(d.streams, "s1", 8)).toBeNull();
  });
});

void DAY;
