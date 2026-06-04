/**
 * Refresh Plaid Data Resolver
 *
 * Resolves dependencies for the combined balance + transaction sync.
 * This is primarily a delegation to the balance sync resolver with
 * additional context for transaction sync.
 *
 * @module resolvers/plaid/refresh_plaid_data
 */
import { TraceContext } from "../../types";
import { ResolveRefreshInput, RefreshPlaidDataDependencies } from "../../types/plaid/refresh_plaid_data.types";
/**
 * Resolves dependencies for the refresh operation.
 *
 * Fetches:
 * - Plaid items for the user
 * - User context (group_ids, family_id, currency)
 * - Rate limit status for each item
 *
 * @param ctx - Trace context
 * @param input - Resolver input
 * @returns Dependencies or null if user has no items
 */
export declare function resolve_refresh_dependencies(ctx: TraceContext, input: ResolveRefreshInput): Promise<RefreshPlaidDataDependencies | null>;
//# sourceMappingURL=refresh_plaid_data.resolver.d.ts.map