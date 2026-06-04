/**
 * Update Link Token Resolver
 *
 * Gathers dependencies needed for update link token creation.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/update_link_token
 */
import { TraceContext } from "../../types";
import { ResolveUpdateLinkTokenInput, UpdateLinkTokenDependencies } from "../../types/plaid/update_link_token.types";
/**
 * Resolves dependencies for update link token creation.
 *
 * Gathers:
 * - Plaid item by ID
 * - Decrypted access token
 * - User profile (display name, email)
 * - Ownership verification
 * - Recent relink attempt count
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
export declare function resolve_update_link_token_dependencies(ctx: TraceContext, input: ResolveUpdateLinkTokenInput): Promise<UpdateLinkTokenDependencies>;
//# sourceMappingURL=update_link_token.resolver.d.ts.map