/**
 * set_budget_pause — pause / resume a budget for exactly the days of one period
 * (Code-Health-Review M1-M1, PZ1–PZ6).
 *
 * @module types/budgets/set_budget_pause
 */
import { z } from "zod";
export declare const set_budget_pause_input_schema: z.ZodObject<{
    budget_id: z.ZodString;
    start_day: z.ZodString;
    end_day: z.ZodString;
    paused: z.ZodBoolean;
}, z.core.$strip>;
export type SetBudgetPauseInput = z.infer<typeof set_budget_pause_input_schema>;
export interface SetBudgetPauseResponse {
    /** The budget's paused ranges after the change ("YYYY-MM-DD", inclusive). */
    paused_ranges: Array<{
        start: string;
        end: string;
    }>;
}
//# sourceMappingURL=set_budget_pause.types.d.ts.map