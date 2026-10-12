import { compute_countable_split_net } from "../period_reconciliation.service";

describe("compute_countable_split_net reads THE split status (spendStatus, else the booleans)", () => {
  it("an Ignored split (spendStatus only, no boolean mirror) adds nothing; a Refund subtracts", () => {
    expect(compute_countable_split_net([{ amount: 15, spendStatus: "ignored" }], "t").amount).toBe(0);
    expect(compute_countable_split_net([{ amount: 15 }, { amount: 5, spendStatus: "refund" }], "t").amount).toBe(10);
    expect(compute_countable_split_net([{ amount: 15, isIgnored: true }], "t").amount).toBe(0);
  });
});
