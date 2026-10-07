import { map_derive_period_result } from "../derive_period.mapper";

const bill = (extra: Record<string, unknown> = {}) => ({
  recurring_id: "o1", name: "Rent", groups: [], ...extra,
});

describe("derive_period mapper — owner badge (Account-Rooted-Sharing 4.5)", () => {
  it("Me output has no ownerUserId key at all (byte-identical to before)", () => {
    const out = map_derive_period_result({
      view_cadence: "monthly", budgets: [], bills: [bill()], income: [bill()],
    } as never);
    expect(Object.keys(out.bills[0])).toEqual(["recurringId", "name", "groups"]);
    expect("ownerUserId" in out.income[0]).toBe(false);
  });
  it("group output carries ownerUserId for bills and income", () => {
    const out = map_derive_period_result({
      view_cadence: "monthly", budgets: [],
      bills: [bill({ owner_user_id: "sam" })], income: [bill({ owner_user_id: "alex" })],
    } as never);
    expect(out.bills[0]).toMatchObject({ ownerUserId: "sam" });
    expect(out.income[0]).toMatchObject({ ownerUserId: "alex" });
  });
});
