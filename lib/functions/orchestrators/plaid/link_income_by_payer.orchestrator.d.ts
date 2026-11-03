/**
 * Link posted deposits to the income line whose description they exactly match (AF-08), for the
 * ones Plaid hasn't listed on the stream. Writes the ids to the line, re-assigns those deposits so
 * their splits carry the link, and returns the follow-ups (reconcile, derive version).
 *
 * The ids are kept in their own field and survive Plaid's stream refresh (`inflow.repo`), so every
 * reader keeps using the one `transactionIds`.
 *
 * Reads the user's income lines only when a candidate deposit exists (usually none).
 *
 * @module orchestrators/plaid/link_income_by_payer
 */
import { TraceContext } from "../../types";
import { SyncFollowUps } from "./sync_follow_ups";
export declare function link_income_by_payer_orchestrator(ctx: TraceContext, user_id: string, run_id: string, docs: Array<Record<string, unknown>>): Promise<{
    follow_ups: SyncFollowUps;
    linked: Map<string, string[]>;
}>;
//# sourceMappingURL=link_income_by_payer.orchestrator.d.ts.map