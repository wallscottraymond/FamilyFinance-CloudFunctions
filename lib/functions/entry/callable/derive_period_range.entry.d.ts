/**
 * Derive Period RANGE Entry Point (read-only)
 *
 * One callable that derives many period windows of a cadence (the Home preload: the last 12
 * periods) — each window's `derive_period` result AND its `derive_goals_view` result — reading the
 * user's definitions + the range's transactions once. Per window the payload is identical to
 * calling `derive_period` / `derive_goals_view` for that window.
 *
 * @module entry/callable/derive_period_range
 */
import { FunctionResponse } from "../../types";
export declare const derive_period_range: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=derive_period_range.entry.d.ts.map