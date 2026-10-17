/**
 * Round-1 review fixes in the D1 matcher (pure): A late arrivals, retro payments belong to their
 * bill alone, the 2-week late-arrival window, and absorbed ids obey the floors.
 */
import { build_converted_index, d1_allows, eligible_bills, ConvertedRecordInput } from "../converted_match.service";
import { converted_key } from "../convert_recurring.service";

const DAY = 86_400_000;
const T0 = Date.UTC(2037, 9, 15);
const rec = (o: Partial<ConvertedRecordInput> & { id: string }): ConvertedRecordInput => ({
  direction: "outflow", is_active: true, is_hidden: false, capture_rules_version: 2, source: "manual",
  vendor_key: "rent", account_id: "a", average_amount: 10, first_date_ms: T0 - 90 * DAY, converted_at_ms: T0, retro_txn_ids: [], ...o,
});
const bills = (...rs: ConvertedRecordInput[]) => build_converted_index(rs).by_key.get(converted_key("outflow", "a", "rent"))!;

describe("A: a payment that ARRIVED after the bill existed", () => {
  const [b] = bills(rec({ id: "b" }));
  it("links when created after the convert day and dated within two weeks before it (pending that posted, early)", () => {
    expect(d1_allows(b, { date_ms: T0 - 3 * DAY, plaid_id: "x", created_ms: T0 + 1000 })).toBe(true);
  });
  it("not older than two weeks, not when it already existed, not without a creation time", () => {
    expect(d1_allows(b, { date_ms: T0 - 20 * DAY, plaid_id: "x", created_ms: T0 + 1000 })).toBe(false);
    expect(d1_allows(b, { date_ms: T0 - 3 * DAY, plaid_id: "x", created_ms: T0 - 1 })).toBe(false);
    expect(d1_allows(b, { date_ms: T0 - 3 * DAY, plaid_id: "x" })).toBe(false);
  });
});

describe("retro payments belong to their bill alone (trigger path and batch path agree)", () => {
  const list = bills(rec({ id: "a_bill", retro_txn_ids: [] }), rec({ id: "b_bill", retro_txn_ids: ["p1"], converted_at_ms: T0 }));
  it("a payment on one bill's retro list is eligible for that bill only, whatever the other's floor", () => {
    expect(eligible_bills(list, { date_ms: T0 - 40 * DAY, plaid_id: "p1" }).map((x) => x.id)).toEqual(["b_bill"]);
  });
  it("other payments compete by the floors as before", () => {
    expect(eligible_bills(list, { date_ms: T0 + DAY, plaid_id: "p9" }).map((x) => x.id)).toEqual(["a_bill", "b_bill"]);
  });
});
