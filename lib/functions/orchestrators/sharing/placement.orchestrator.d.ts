/**
 * Account Placement Orchestrators (P1, D7, N9, I4, D25)
 *
 * share_account: the owner shares an account with a group (requests to the
 * other members, or applied at once in a group of one).
 * unshare_account: the owner makes it private again (no Accept needed).
 *
 * Accepting a share request lives in respond_to_request (groups orchestrator).
 *
 * @module orchestrators/sharing/placement
 */
import { OrchestratorContext } from "../../types";
import { PersonView } from "../../types/sharing.types";
export interface ShareAccountResult {
    success: boolean;
    errors?: string[];
    /** "shared" = applied now; "requested" = waiting for a member to accept. */
    status?: "shared" | "requested";
    /** Set when someone in the group already shares the same real account (I4). */
    already_shared_by?: PersonView;
}
/** Shares an account with a group. */
export declare function share_account_orchestrator(ctx: OrchestratorContext<{
    account_id: string;
    group_id: string;
    include_history: boolean;
    /** "From today on": the user's local today, as a UTC-midnight ms (app ≥ this build). */
    share_from_ms?: number | null;
}>): Promise<ShareAccountResult>;
/** Makes a shared account private again; cancels any pending share requests. */
export declare function unshare_account_orchestrator(ctx: OrchestratorContext<{
    account_id: string;
}>): Promise<ShareAccountResult>;
//# sourceMappingURL=placement.orchestrator.d.ts.map