/**
 * Derive Goals View Entry Point — Goals (Phase 1)
 *
 * onCall read endpoint for the period-page Goals section: given a period_id,
 * returns each active goal + its measured progress for that period. Read-only.
 *
 * @module entry/callable/derive_goals_view
 */
import { DeriveGoalsViewResult } from "../../orchestrators/goals";
import { FunctionResponse } from "../../types";
export declare const derive_goals_view: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<DeriveGoalsViewResult>>, unknown>;
//# sourceMappingURL=derive_goals_view.entry.d.ts.map