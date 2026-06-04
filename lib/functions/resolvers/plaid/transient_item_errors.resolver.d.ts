/**
 * Transient Item Errors Resolver
 *
 * READ-ONLY impact analysis for the auto-retry job: find the active Plaid items
 * currently sitting in a transient error state (institution down / rate limited)
 * that are candidates for a silent retry. No mutations.
 *
 * @module resolvers/plaid/transient_item_errors
 */
import { TraceContext } from "../../types";
import { TransientItemToRetry } from "../../types/plaid/transient_error_retry.types";
/**
 * Resolves the items awaiting a silent retry.
 *
 * @param ctx - Trace context
 * @returns Items in a transient error state (capped at MAX_ITEMS_PER_RUN)
 */
export declare function resolve_transient_items_to_retry(ctx: TraceContext): Promise<TransientItemToRetry[]>;
//# sourceMappingURL=transient_item_errors.resolver.d.ts.map