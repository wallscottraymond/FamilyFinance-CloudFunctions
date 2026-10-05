/**
 * Goals paused when their linked account is removed — Domain Unit Tests.
 */

import { goals_to_pause_on_account_removal } from "../goal.service";
import { GoalEntity } from "../../../types/goals/goal_entity.types";

const goal = (id: string, status: GoalEntity["status"]) =>
  ({ id, status, linked_account_id: "acct_1" } as unknown as GoalEntity);

describe("goals_to_pause_on_account_removal", () => {
  it("pauses only active goals", () => {
    expect(
      goals_to_pause_on_account_removal([
        goal("a", "active"),
        goal("b", "paused"),
        goal("c", "completed"),
        goal("d", "active"),
      ])
    ).toEqual(["a", "d"]);
  });

  it("does nothing when no goal watches the account", () => {
    expect(goals_to_pause_on_account_removal([])).toEqual([]);
  });
});
