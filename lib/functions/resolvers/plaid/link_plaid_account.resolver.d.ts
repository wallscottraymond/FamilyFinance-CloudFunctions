/**
 * Link Plaid Account Resolver
 *
 * Gathers dependencies needed for linking a Plaid account.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/link_plaid_account
 */
import { TraceContext, LinkAccountDependencies, ResolveLinkAccountInput } from "../../types";
/**
 * Resolves dependencies for linking a Plaid account.
 *
 * Gathers:
 * - User's group IDs for RBAC
 * - Whether the institution is already linked (duplicate detection)
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
export declare function resolve_link_account_dependencies(ctx: TraceContext, input: ResolveLinkAccountInput): Promise<LinkAccountDependencies>;
//# sourceMappingURL=link_plaid_account.resolver.d.ts.map