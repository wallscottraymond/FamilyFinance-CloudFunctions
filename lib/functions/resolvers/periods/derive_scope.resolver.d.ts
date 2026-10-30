/**
 * Derive Scope Resolver (Account-Rooted-Sharing D2; Rules §4.1–4.2)
 *
 * READ-ONLY. Turns a scope request into a resolved scope, server-side. Never
 * trusts a client-sent account list: the account set comes from placements.
 *   - Me: the caller's ACTIVE accounts that are shared are excluded (an inactive
 *     shared account counts nowhere in a group, so its kept history stays in Me).
 *   - Group: the caller must be a member (else PermissionDeniedError); the view
 *     is the group's active shared accounts whose owner is still a member.
 *
 * @module resolvers/periods/derive_scope
 */
import { TraceContext } from "../../types";
import { DeriveScope, DeriveScopeRequest } from "../../domain/periods/derive_scope.service";
/**
 * Pairing-only transactions (D12): for Me, the user's groups' shared accounts owned by other
 * members, so a transfer into a group account is recognized as one. Never counted. Empty when
 * the scope has nothing extra (always, for a user in no groups).
 */
export declare function load_pairing_extra_txns(ctx: TraceContext, scope: DeriveScope, start_ms: number, end_ms: number): Promise<Array<{
    id: string;
    data: Record<string, unknown>;
}>>;
export declare function resolve_derive_scope(ctx: TraceContext, caller_id: string, request: DeriveScopeRequest | undefined): Promise<DeriveScope>;
//# sourceMappingURL=derive_scope.resolver.d.ts.map