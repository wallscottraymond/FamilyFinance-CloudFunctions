/**
 * build_goals_view owner tag (Account-Rooted-Sharing): group views carry each goal's owner for
 * the owner badge; Me views are unchanged (no ownerUserId key at all).
 */
import { build_goals_view } from "../goals_view.service";
import { GoalEntity, GoalMeasurement } from "../../../types/goals/goal_entity.types";

const goal = { id: "g1", owner_id: "alice", goal_type: "savings", name: "Trip", status: "active",
  linked_account_id: "acc1", target_amount: 1000, home_cadence: "monthly", per_period_amount: 100,
  priority_rank: 1, draws_income: true, baseline_balance: 0 } as unknown as GoalEntity;
const measurement = { goal_id: "g1", period_id: "2026M10", target_for_period: 100,
  progress_for_period: 40, cumulative_progress: 40, met: false, target_reached: false,
  data_incomplete: false } as GoalMeasurement;

describe("build_goals_view owner tag", () => {
  it("Me view: no ownerUserId", () => {
    const v = build_goals_view("2026M10", [{ goal, measurement }]);
    expect("ownerUserId" in v.goals[0]).toBe(false);
  });

  it("group view: ownerUserId = the goal's owner", () => {
    const v = build_goals_view("2026M10", [{ goal, measurement }], true);
    expect(v.goals[0].ownerUserId).toBe("alice");
    expect(v.totalDrawThisPeriod).toBe(100);
  });
});
