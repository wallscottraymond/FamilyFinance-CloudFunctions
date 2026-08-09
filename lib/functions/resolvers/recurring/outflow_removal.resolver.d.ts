/**
 * Outflow Removal Resolver
 *
 * READ-ONLY: load the context needed to remove/pause/restore/delete a recurring
 * outflow — its owner + group access (for authorization) and its current
 * `removal_intervals` (which the domain applies the action to). Loads with
 * `include_deleted` so an already-removed item is still manageable.
 *
 * @module resolvers/recurring/outflow_removal
 */
import { TraceContext } from "../../types";
import { RemovalInterval } from "../../domain/recurring/recurring_suppression.service";
export interface OutflowRemovalContext {
    outflow_id: string;
    owner_id: string;
    group_ids: string[];
    removal_intervals: RemovalInterval[];
}
/** Load the removal context for an outflow, or null if it doesn't exist. */
export declare function resolve_outflow_removal_context(ctx: TraceContext, outflow_id: string): Promise<OutflowRemovalContext | null>;
//# sourceMappingURL=outflow_removal.resolver.d.ts.map