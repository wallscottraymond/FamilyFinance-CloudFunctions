/**
 * Assign Split → Bill (Outflow) Entry Point
 *
 * Manually pin a transaction split to a recurring bill (outflow), or clear the pin
 * (`outflow_id: null`). The pin is DURABLE: the split records
 * `outflowAssignmentSource="manual"`, which the Transaction Assignment Engine
 * preserves across Plaid re-syncs (mirrors the manual budget pin). The write sets the
 * queryable `splitOutflowIds` denorm and fires `on_transaction_written`, which enqueues
 * the recurring reconcile — so the bill marks paid (counting a pending payment as
 * paid·pending). This is the manual escape hatch for when auto-matching misses.
 *
 * @module entry/callable/assign_split_to_outflow
 */
import { FunctionResponse } from "../../types";
export declare const assign_split_to_outflow: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=assign_split_to_outflow.entry.d.ts.map