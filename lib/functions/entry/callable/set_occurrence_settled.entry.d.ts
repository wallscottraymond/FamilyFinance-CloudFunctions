/**
 * Set Occurrence Settled Entry Point ("Mark as paid" / "Mark as received")
 *
 * Marks ONE occurrence of a recurring bill (`kind: "outflow"`) or income (`kind: "inflow"`)
 * settled by hand — paid in cash / Venmo / from an unlinked account, so no transaction will
 * arrive — or clears the mark (`settled: false`). A real payment that later settles the
 * occurrence wins over the mark (never double-counted). Delegates to the orchestrator.
 *
 * @module entry/callable/set_occurrence_settled
 */
import { FunctionResponse } from "../../types";
export declare const set_occurrence_settled: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=set_occurrence_settled.entry.d.ts.map