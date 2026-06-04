/**
 * Initial Sync Resolver
 *
 * Gathers dependencies for the initial sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user's group_ids for RBAC
 * - Builds institution info for account creation
 *
 * @module resolvers/plaid/initial_sync
 */
import { TraceContext } from "../../types";
import { InitialSyncInput, InitialSyncDependencies } from "../../types/plaid";
/**
 * Resolves dependencies needed for the initial sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item document
 * 2. Decrypts the access token
 * 3. Fetches user profile for group_ids
 * 4. Builds institution info
 *
 * @param ctx - Trace context
 * @param input - Initial sync input
 * @returns Dependencies for the orchestrator
 */
export declare function resolve_initial_sync_dependencies(ctx: TraceContext, input: InitialSyncInput): Promise<InitialSyncDependencies>;
//# sourceMappingURL=initial_sync.resolver.d.ts.map