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

describe("derive_period mapper — dailySpent", () => {
  it("carries each budget period's daily_spent as dailySpent", () => {
    const out = map_derive_period_result({
      view_cadence: "weekly", bills: [], income: [],
      budgets: [{
        budget_id: "b", name: "Food", is_everything_else: false,
        periods: [{ period_id: "w", spent: 3, daily_spent: [1, 0, 2] }],
      }],
    } as never);
    expect(out.budgets[0].periods[0].dailySpent).toEqual([1, 0, 2]);
  });
});

describe("derive_period mapper — Easy to change breakdown", () => {
  it("carries dailyCount, places (camelCase), fees and firstCategoryIds", () => {
    const out = map_derive_period_result({
      view_cadence: "weekly", bills: [], income: [],
      budgets: [{
        budget_id: "b", name: "Food", is_everything_else: false, first_category_ids: ["groceries"],
        periods: [{
          period_id: "w", spent: 3, daily_spent: [1, 0, 2], daily_count: [1, 0, 2],
          places: [{ key: "aldi", name: "Aldi", count: 3, small_count: 2, total: 3 }],
          fees: [{ kind: "atm", count: 1, total: 2.5 }],
        }],
      }],
    } as never);
    const b = out.budgets[0];
    expect(b.firstCategoryIds).toEqual(["groceries"]);
    expect(b.periods[0].dailyCount).toEqual([1, 0, 2]);
    expect(b.periods[0].places).toEqual([{ key: "aldi", name: "Aldi", count: 3, smallCount: 2, total: 3 }]);
    expect(b.periods[0].fees).toEqual([{ kind: "atm", count: 1, total: 2.5 }]);
  });

  it("defaults the new fields to empty arrays", () => {
    const out = map_derive_period_result({
      view_cadence: "weekly", bills: [], income: [],
      budgets: [{ budget_id: "e", name: "EE", is_everything_else: true, periods: [{ period_id: "w" }] }],
    } as never);
    expect(out.budgets[0].firstCategoryIds).toEqual([]);
    expect(out.budgets[0].periods[0]).toMatchObject({ dailyCount: [], places: [], fees: [] });
  });
});
