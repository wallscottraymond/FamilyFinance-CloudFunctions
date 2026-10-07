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
