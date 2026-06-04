/**
 * Link Token Resolver
 *
 * Gathers dependencies needed for link token creation.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/link_token
 */
import { TraceContext, LinkTokenDependencies, ResolveLinkTokenInput } from "../../types";
/**
 * Resolves dependencies for link token creation.
 *
 * Gathers:
 * - User profile (display name, email)
 * - Existing Plaid items count (for future account limits)
 * - Cached token if available
 * - Access token validity for update mode
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
export declare function resolve_link_token_dependencies(ctx: TraceContext, input: ResolveLinkTokenInput): Promise<LinkTokenDependencies>;
//# sourceMappingURL=link_token.resolver.d.ts.map