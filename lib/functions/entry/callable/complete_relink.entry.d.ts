/**
 * Complete Relink Entry Point
 *
 * Called by the app right after Plaid update-mode Link succeeds. Plaid sends no
 * webhook for a repair done in our app, so without this the item would stay
 * flagged (and skipped by the scheduled syncs) until the self-heal pass ran.
 *
 * @module entry/callable/complete_relink
 */
import { FunctionResponse } from "../../types";
import { CompleteRelinkResponse } from "../../types/plaid/reauth_recovery.types";
/**
 * Confirms a reconnection, marks the item healthy, and refreshes its data.
 *
 * @param request.data.item_id - The Plaid item document ID
 * @returns Whether the item is repaired and its status
 */
export declare const complete_relink: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<CompleteRelinkResponse>>, unknown>;
//# sourceMappingURL=complete_relink.entry.d.ts.map