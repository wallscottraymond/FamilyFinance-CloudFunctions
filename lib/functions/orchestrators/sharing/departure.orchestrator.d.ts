/**
 * Departure Orchestrator (D13) — used by account purge.
 *
 * Takes a user out of every group the same way leaving does (the departing
 * person's accounts stop counting; their solo groups close), and removes their
 * connections and connect code. Owned groups that still have other members must
 * be handed over first; purge blocks on those before it gets here.
 *
 * Requests from / to the user are hard-deleted by the purge sweep itself.
 *
 * @module orchestrators/sharing/departure
 */
import { TraceContext } from "../../types";
export interface DepartureResult {
    groups_left: number;
    groups_closed: number;
    connections_removed: number;
    /** Groups the user couldn't leave (owner with members) — purge should have blocked. */
    blocked_group_ids: string[];
}
/** Removes a user from all sharing. Idempotent: re-running finds nothing left. */
export declare function release_user_from_sharing(ctx: TraceContext, user_id: string): Promise<DepartureResult>;
//# sourceMappingURL=departure.orchestrator.d.ts.map