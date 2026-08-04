/**
 * Derive Period Entry Point (batched)
 *
 * One callable that derives a whole period view — budgets, bills, income — for a
 * cadence + window, on read. Replaces ~N per-item calls with one round-trip.
 * Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_period
 */
import { FunctionResponse } from "../../types";
export declare const derive_period: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=derive_period.entry.d.ts.map