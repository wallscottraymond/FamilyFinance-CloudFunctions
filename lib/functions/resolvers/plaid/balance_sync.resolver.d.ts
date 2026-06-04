/**
 * Balance Sync Resolver
 *
 * Gathers dependencies for the balance sync orchestrator.
 * - Fetches plaid_items and decrypts access tokens
 * - Fetches local accounts for balance comparison
 *
 * @module resolvers/plaid/balance_sync
 */
import { TraceContext } from "../../types";
import { ResolveBalanceSyncInput, BalanceSyncDependencies } from "../../types/plaid";
/**
 * Resolves dependencies needed for the balance sync orchestrator.
 *
 * This resolver:
 * 1. Fetches active plaid_items for the user (or specific item)
 * 2. Decrypts access tokens
 * 3. Fetches local accounts grouped by item for matching
 *
 * @param ctx - Trace context
 * @param input - Balance sync input
 * @returns Dependencies for the orchestrator
 */
export declare function resolve_balance_sync_dependencies(ctx: TraceContext, input: ResolveBalanceSyncInput): Promise<BalanceSyncDependencies>;
//# sourceMappingURL=balance_sync.resolver.d.ts.map