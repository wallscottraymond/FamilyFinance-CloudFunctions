import { GoalSummaryData } from "../../../types/periodSummaries";

/**
 * Calculates goal summary data (PLACEHOLDER/STUB)
 *
 * Goals are not yet implemented in the system. This function returns
 * an empty summary object with all values set to 0.
 *
 * When goals are implemented, this function should:
 * 1. Accept an array of goal_periods
 * 2. Calculate totals (targetAmount, savedAmount, remainingAmount)
 * 3. Count goals (total, onTrack, behind, completed)
 * 4. Optionally build detailed entries
 *
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns GoalSummaryData object with zero values
 */
export function calculateGoalSummary(
  includeEntries: boolean = false
): GoalSummaryData {
  console.log(
    `[calculateGoalSummary] Returning empty stub (goals not yet implemented)`
  );

  const summary: GoalSummaryData = {
    totalTargetAmount: 0,
    totalSavedAmount: 0,
    totalRemainingAmount: 0,
    totalCount: 0,
    onTrackCount: 0,
    behindCount: 0,
    completedCount: 0,
  };

  // Add empty entries array if requested
  if (includeEntries) {
    summary.entries = [];
  }

  return summary;
}
