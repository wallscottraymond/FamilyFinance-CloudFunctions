/**
 * D1 matching (Convert-To-Recurring Phase 2): the converted index, the date floor, and the
 * deterministic choice between bills of one key (D44).
 */
import {
  ConvertedRecordInput,
  build_converted_index,
  d1_allows,
  pick_converted_bill,
} from "../converted_match.service";
import { converted_key } from "../convert_recurring.service";

const DAY = 86_400_000;
const T0 = Date.UTC(2037, 9, 1);

const rec = (o: Partial<ConvertedRecordInput> & { id: string }): ConvertedRecordInput => ({
  direction: "outflow", is_active: true, is_hidden: false, merged_into_id: null, capture_rules_version: 2, source: "manual",
  vendor_key: "netflix", account_id: "acc1", average_amount: 15, expected_amount_override: null,
  first_date_ms: T0 - 60 * DAY, converted_at_ms: T0, retro_txn_ids: [], ...o,
});

describe("build_converted_index", () => {
  it("indexes only active, shown, un-merged v2 manual records with a key and an account", () => {
    const idx = build_converted_index([
      rec({ id: "a" }),
      rec({ id: "inactive", is_active: false }),
      rec({ id: "hidden", is_hidden: true }),
      rec({ id: "merged", merged_into_id: "a" }),
      rec({ id: "plaid", source: "plaid" }),
      rec({ id: "old", capture_rules_version: null }),
      rec({ id: "nokey", vendor_key: null }),
      rec({ id: "noacct", account_id: "" }),
    ]);
    expect([...idx.ids]).toEqual(["a"]);
    expect(idx.by_key.get(converted_key("outflow", "acc1", "netflix"))!.map((b) => b.id)).toEqual(["a"]);
  });

  it("keeps direction apart and sorts bills of one key by id", () => {
    const idx = build_converted_index([
      rec({ id: "z" }), rec({ id: "b" }), rec({ id: "in", direction: "inflow" }),
    ]);
    expect(idx.by_key.get(converted_key("outflow", "acc1", "netflix"))!.map((b) => b.id)).toEqual(["b", "z"]);
    expect(idx.by_key.get(converted_key("inflow", "acc1", "netflix"))!.map((b) => b.id)).toEqual(["in"]);
  });

  it("a record with no stored converted_at falls back to its first date minus the early pad", () => {
    const idx = build_converted_index([rec({ id: "a", converted_at_ms: null, first_date_ms: T0 })]);
    const bill = idx.by_key.get(converted_key("outflow", "acc1", "netflix"))![0];
    expect(bill.d1_from_ms).toBe(T0 - 7 * DAY);
  });
});

describe("d1_allows (the date floor)", () => {
  const idx = build_converted_index([rec({ id: "a", retro_txn_ids: ["p_old"] })]);
  const bill = idx.by_key.get(converted_key("outflow", "acc1", "netflix"))![0];
  it("links payments from the day the bill was created", () => {
    expect(d1_allows(bill, { date_ms: T0, plaid_id: "p1" })).toBe(true);
    expect(d1_allows(bill, { date_ms: T0 + 30 * DAY, plaid_id: null })).toBe(true);
  });
  it("leaves earlier payments in budgets, except the ones a convert linked (D46)", () => {
    expect(d1_allows(bill, { date_ms: T0 - 1, plaid_id: "p_other" })).toBe(false);
    expect(d1_allows(bill, { date_ms: T0 - 40 * DAY, plaid_id: "p_old" })).toBe(true);
  });
});

describe("pick_converted_bill (D44)", () => {
  const idx = build_converted_index([
    rec({ id: "icloud", average_amount: 3 }),
    rec({ id: "music", average_amount: 11 }),
    rec({ id: "tie_b", average_amount: 20 }),
    rec({ id: "tie_a", average_amount: 20 }),
  ]);
  const all = idx.by_key.get(converted_key("outflow", "acc1", "netflix"))!;
  const only = (...ids: string[]) => all.filter((b) => ids.includes(b.id));
  it("a lone bill is final", () => {
    expect(pick_converted_bill(only("music"), 999, null)).toBe("music");
    expect(pick_converted_bill([], 5, null)).toBeNull();
  });
  it("the scorer's restricted decision wins when it decides", () => {
    expect(pick_converted_bill(only("icloud", "music"), 3, "music")).toBe("music");
  });
  it("else the closest amount, then the smallest id; never depends on input order", () => {
    expect(pick_converted_bill(only("icloud", "music"), 4, null)).toBe("icloud");
    expect(pick_converted_bill(only("icloud", "music"), 10, null)).toBe("music");
    expect(pick_converted_bill(only("tie_b", "tie_a"), 20, null)).toBe("tie_a");
    expect(pick_converted_bill([...only("tie_b", "tie_a")].reverse(), 20, null)).toBe("tie_a");
    expect(pick_converted_bill(only("icloud", "music"), 4, "gone")).toBe("icloud");
  });
});
