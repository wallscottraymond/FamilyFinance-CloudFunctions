/**
 * Re-authentication Recovery Orchestrators
 *
 * Confirms that a Plaid item needing re-authentication works again, marks it
 * healthy, and refreshes its data (balances, transactions, recurring).
 *
 * Three ways in, one path:
 *  - `complete_relink` callable: the app calls it right after update-mode Link
 *    succeeds (Plaid sends no webhook for an in-app repair).
 *  - Scheduled self-heal: every 4h, probes items still flagged for re-auth, so a
 *    repair is picked up even when the app never reported it (older builds) or
 *    the user fixed it at the bank.
 *  - LOGIN_REPAIRED webhook (`handle_login_repaired`): Plaid says it's fixed, so
 *    no probe is needed — it calls `mark_item_repaired` + `refresh_repaired_item`.
 *
 * @module orchestrators/plaid/reauth_recovery
 */
import { OrchestratorContext, TraceContext } from "../../types";
import { CompleteRelinkInput, CompleteRelinkResponse, ReauthSelfHealResult } from "../../types/plaid/reauth_recovery.types";
/**
 * Orchestrator result for complete_relink.
 */
export interface CompleteRelinkResult {
    success: boolean;
    data?: CompleteRelinkResponse;
    error_code?: string;
    error?: string;
}
/**
 * The item identity the repair/refresh steps need.
 */
interface RepairTarget {
    item_doc_id: string;
    plaid_item_id: string;
    user_id: string;
}
/**
 * Clears the item's error state and closes its open relink attempts.
 *
 * @param ctx - Trace context
 * @param target - The item to mark healthy
 */
export declare function mark_item_repaired(ctx: TraceContext, target: RepairTarget): Promise<void>;
/**
 * Pulls everything that may have been missed while the item was broken:
 * balances, transactions (cursor-based, so only the gap), and recurring streams.
 * Each step is independent; a failure in one doesn't stop the others.
 *
 * @param ctx - Trace context
 * @param target - The repaired item
 * @returns Whether every step succeeded
 */
export declare function refresh_repaired_item(ctx: TraceContext, target: RepairTarget): Promise<boolean>;
/**
 * Called by the app right after update-mode Link succeeds. Confirms with Plaid
 * that the item works, then marks it healthy and refreshes its data.
 *
 * @param ctx - Orchestrator context (input.item_id = item document ID)
 * @returns Whether the item is repaired, its status, and whether data refreshed
 */
export declare function complete_relink_orchestrator(ctx: OrchestratorContext<CompleteRelinkInput>): Promise<CompleteRelinkResult>;
/**
 * Scheduled self-heal: probes every item still flagged for re-auth and repairs
 * the ones that work again.
 *
 * @param ctx - Trace context
 * @returns Counts for the run
 */
export declare function self_heal_reauth_items_orchestrator(ctx: TraceContext): Promise<ReauthSelfHealResult>;
export {};
//# sourceMappingURL=reauth_recovery.orchestrator.d.ts.map