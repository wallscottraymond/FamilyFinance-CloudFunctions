/**
 * set_budget_pause — pause / resume a budget for exactly the days of one period
 * (Code-Health-Review M1-M1, PZ1–PZ6).
 *
 * @module types/budgets/set_budget_pause
 */

import { z } from "zod";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const set_budget_pause_input_schema = z.object({
  budget_id: z.string().min(1),
  /** First and last day of the period being paused / resumed (inclusive, UTC calendar days). */
  start_day: z.string().regex(ISO_DAY, "start_day must be YYYY-MM-DD"),
  end_day: z.string().regex(ISO_DAY, "end_day must be YYYY-MM-DD"),
  paused: z.boolean(),
});
export type SetBudgetPauseInput = z.infer<typeof set_budget_pause_input_schema>;

export interface SetBudgetPauseResponse {
  /** The budget's paused ranges after the change ("YYYY-MM-DD", inclusive). */
  paused_ranges: Array<{ start: string; end: string }>;
}
