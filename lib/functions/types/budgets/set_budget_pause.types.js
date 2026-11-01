"use strict";
/**
 * set_budget_pause — pause / resume a budget for exactly the days of one period
 * (Code-Health-Review M1-M1, PZ1–PZ6).
 *
 * @module types/budgets/set_budget_pause
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_budget_pause_input_schema = void 0;
const zod_1 = require("zod");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
exports.set_budget_pause_input_schema = zod_1.z.object({
    budget_id: zod_1.z.string().min(1),
    /** First and last day of the period being paused / resumed (inclusive, UTC calendar days). */
    start_day: zod_1.z.string().regex(ISO_DAY, "start_day must be YYYY-MM-DD"),
    end_day: zod_1.z.string().regex(ISO_DAY, "end_day must be YYYY-MM-DD"),
    paused: zod_1.z.boolean(),
});
//# sourceMappingURL=set_budget_pause.types.js.map