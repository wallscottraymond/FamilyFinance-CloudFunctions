/**
 * Budget view unit tests (Account-Rooted-Sharing Phase 2.2, PD6).
 * Test IDs refer to Account-Rooted-Sharing-Tests.md §10 + §13.
 */

import {
  group_view_key,
  group_id_of_key,
  can_manage_budget,
  plan_move_budget,
  plan_copy_budgets,
  budgets_returned,
  plan_budget_returns,
  return_pause_range,
  ViewBudget,
} from "../budget_view.service";
import { build_group, accept_join } from "../group.service";
import { Group } from "../../../types/sharing.types";

const NOW = 1_800_000_000_000;
function group(members: string[], id = "g1"): Group {
  const g = build_group(id, "The Walls", members[0], 0, NOW).entity!.group;
  return members.slice(1).reduce((acc, m) => accept_join(acc, m, 0, NOW).entity!.group, g);
}
const b = (over: Partial<ViewBudget> = {}): ViewBudget => ({
  id: "groc", owner_key: "alex", name: "Groceries", amount: 400,
  category_ids: ["FOOD_GROCERIES"], is_everything_else: false, brought_by: null, ...over,
});
const walls = group(["alex", "sam"]);
const KEY = group_view_key("g1");

describe("view keys", () => {
  it("round-trip", () => {
    expect(KEY).toBe("group:g1");
    expect(group_id_of_key(KEY)).toBe("g1");
    expect(group_id_of_key("alex")).toBeNull();
  });
  it("who can manage: Me = owner; group = any member", () => {
    expect(can_manage_budget("alex", "alex", null)).toBe(true);
    expect(can_manage_budget("alex", "sam", null)).toBe(false);
    expect(can_manage_budget(KEY, "sam", walls)).toBe(true);
    expect(can_manage_budget(KEY, "riley", walls)).toBe(false);
    expect(can_manage_budget(KEY, "sam", null)).toBe(false);
  });
});

describe("move (D9)", () => {
  it("T-DF-03 Me → group: owner + member; broughtBy = mover", () => {
    const r = plan_move_budget(b(), "alex", null, { type: "group", group: walls }, []);
    expect(r.entity).toEqual({ new_owner_key: KEY, brought_by: "alex" });
  });
  it("T-DF-02 group → Me: any member; lands in the mover's Me", () => {
    const r = plan_move_budget(b({ owner_key: KEY }), "sam", walls, { type: "me" }, []);
    expect(r.entity).toEqual({ new_owner_key: "sam", brought_by: null });
  });
  it("refuses: not yours, not a member, EE, clash in the destination", () => {
    expect(plan_move_budget(b(), "sam", null, { type: "group", group: walls }, []).validation_errors)
      .toBeDefined();
    const other = group(["riley"], "g2");
    expect(plan_move_budget(b(), "alex", null, { type: "group", group: other }, []).validation_errors)
      .toBeDefined();
    expect(plan_move_budget(b({ is_everything_else: true }), "alex", null,
      { type: "group", group: walls }, []).validation_errors).toBeDefined();
    const clash = b({ id: "theirs", owner_key: KEY, name: "Food" });
    expect(plan_move_budget(b(), "alex", null, { type: "group", group: walls }, [clash])
      .validation_errors?.[0]).toMatch(/Food/);
  });
});

describe("copy (D32)", () => {
  it("T-DF-13 creates copies; T-DF-15 a clash becomes a conflict (Add mine)", () => {
    const dining = b({ id: "din", name: "Dining Out", category_ids: ["FOOD_RESTAURANT"] });
    const sams_groc = b({ id: "sg", owner_key: KEY, amount: 300, brought_by: null });
    const plan = plan_copy_budgets(walls, "alex",
      [{ budget: b(), amount: 400 }, { budget: dining, amount: 350 }], [sams_groc]).entity!;
    expect(plan.creates.map((c) => [c.source.id, c.amount])).toEqual([["din", 350]]);
    expect(plan.conflicts).toEqual([{
      source_budget_id: "groc", existing_budget_id: "sg", existing_name: "Groceries", existing_amount: 300,
    }]);
  });
  it("T-DF-17 never EE; only your own; amount > 0; member only", () => {
    expect(plan_copy_budgets(walls, "alex", [{ budget: b({ is_everything_else: true }), amount: 1 }], [])
      .validation_errors).toBeDefined();
    expect(plan_copy_budgets(walls, "sam", [{ budget: b(), amount: 1 }], []).validation_errors)
      .toBeDefined();
    expect(plan_copy_budgets(walls, "alex", [{ budget: b(), amount: 0 }], []).validation_errors)
      .toBeDefined();
    expect(plan_copy_budgets(group(["riley"]), "alex", [{ budget: b(), amount: 1 }], [])
      .validation_errors).toBeDefined();
  });
  it("two of my own budgets that clash with each other → second is a conflict", () => {
    const plan = plan_copy_budgets(walls, "alex",
      [{ budget: b(), amount: 1 }, { budget: b({ id: "groc2" }), amount: 2 }], []).entity!;
    expect(plan.creates).toHaveLength(1);
    expect(plan.conflicts).toHaveLength(1);
  });
  it("X16 partial overlap: the categories the group doesn't budget are copied; the rest stay a conflict", () => {
    const food = b({ id: "food", name: "Food", category_ids: ["groceries", "coffee"] });
    const sams_groc = b({ id: "sg", owner_key: KEY, name: "Groceries", category_ids: ["groceries"], amount: 300 });
    const plan = plan_copy_budgets(walls, "alex", [{ budget: food, amount: 200 }], [sams_groc]).entity!;
    expect(plan.creates.map((c) => [c.source.id, c.category_ids])).toEqual([["food", ["coffee"]]]);
    expect(plan.conflicts[0]).toMatchObject({ existing_budget_id: "sg", copied_category_ids: ["coffee"] });
  });
  it("X16 a same-NAME clash, nothing left, or a MOVE copies nothing", () => {
    const groc = b({ id: "g2", name: "Groceries", category_ids: ["groceries", "coffee"] });
    const sams = b({ id: "sg", owner_key: KEY, name: "Groceries", category_ids: ["groceries"] });
    expect(plan_copy_budgets(walls, "alex", [{ budget: groc, amount: 1 }], [sams]).entity!.creates).toEqual([]);
    const food = b({ id: "food", name: "Food", category_ids: ["groceries", "coffee"] });
    expect(plan_copy_budgets(walls, "alex", [{ budget: food, amount: 1 }], [sams], undefined, false).entity!.creates).toEqual([]);
    const only = b({ id: "only", name: "Food", category_ids: ["groceries"] });
    expect(plan_copy_budgets(walls, "alex", [{ budget: only, amount: 1 }], [sams]).entity!.creates).toEqual([]);
  });
});

describe("leaving returns moved-in budgets (D13)", () => {
  const budgets = [
    b({ id: "moved_by_sam", owner_key: KEY, brought_by: "sam" }),
    b({ id: "made_here", owner_key: KEY, brought_by: null }),
    b({ id: "moved_by_alex", owner_key: KEY, brought_by: "alex" }),
  ];
  it("T-LV-04a/b the leaver's moved-in budgets go back; group-made stay", () => {
    expect(budgets_returned(budgets, ["sam"])).toEqual([{ budget_id: "moved_by_sam", to_owner_key: "sam" }]);
    expect(budgets_returned(budgets, "all").map((r) => r.budget_id))
      .toEqual(["moved_by_sam", "moved_by_alex"]);
  });
});

describe("returning budgets meet the Me view (S1-M4, user decision 2026-11-02)", () => {
  const first_of = (c: string) => (c === "FOOD_AND_DRINK_GROCERIES" ? "groceries" : c);
  const moved = (over: Partial<ViewBudget>) =>
    b({ owner_key: KEY, brought_by: "sam", ...over });
  it("a clashing category stays with the Me budget; the returning one keeps the rest", () => {
    const out = plan_budget_returns(
      [moved({ id: "food", name: "Food", category_ids: ["FOOD_AND_DRINK_GROCERIES", "coffee"] })],
      ["sam"],
      { sam: [b({ id: "mine", owner_key: "sam", category_ids: ["groceries"] })] },
      first_of
    );
    expect(out).toEqual([{
      budget_id: "food", name: "Food", to_owner_key: "sam",
      category_ids: ["coffee"], removed_category_ids: ["FOOD_AND_DRINK_GROCERIES"], paused: false,
    }]);
  });
  it("nothing left → comes back paused; no clash → unchanged", () => {
    const out = plan_budget_returns(
      [
        moved({ id: "g2", name: "Groceries 2", category_ids: ["groceries"] }),
        moved({ id: "gas", name: "Gas", category_ids: ["gas"] }),
      ],
      ["sam"],
      { sam: [b({ id: "mine", owner_key: "sam", category_ids: ["FOOD_AND_DRINK_GROCERIES"] })] },
      first_of
    );
    expect(out.map((r) => [r.budget_id, r.category_ids, r.paused])).toEqual([
      ["g2", [], true],
      ["gas", ["gas"], false],
    ]);
  });
  it("Everything Else owns nothing; two returns to one person see each other; others untouched", () => {
    const out = plan_budget_returns(
      [
        moved({ id: "a", name: "A", category_ids: ["x", "y"] }),
        moved({ id: "b", name: "B", category_ids: ["y"] }),
        moved({ id: "c", name: "C", category_ids: ["y"], brought_by: "alex" }),
      ],
      "all",
      { sam: [b({ id: "ee", owner_key: "sam", category_ids: ["x"], is_everything_else: true })] },
      first_of
    );
    expect(out.map((r) => [r.budget_id, r.to_owner_key, r.category_ids, r.paused])).toEqual([
      ["a", "sam", ["x", "y"], false],
      ["b", "sam", [], true],
      ["c", "alex", ["y"], false],
    ]);
  });
  it("a budget that never had categories isn't paused by a return", () => {
    const out = plan_budget_returns([moved({ id: "e", category_ids: [] })], ["sam"], {}, first_of);
    expect(out[0]).toMatchObject({ category_ids: [], removed_category_ids: [], paused: false });
  });
  it("the pause runs from today's UTC day to far in the future", () => {
    const r = return_pause_range(Date.UTC(2026, 10, 2, 23, 59));
    expect(r.start_day).toBe(Date.UTC(2026, 10, 2) / 86_400_000);
    expect(r.end_day).toBe(Date.UTC(2099, 11, 31) / 86_400_000);
  });
});
