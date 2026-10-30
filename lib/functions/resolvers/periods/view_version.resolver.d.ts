/**
 * View Version Resolver (Account-Rooted-Sharing; derive caches)
 *
 * READ-ONLY. The cache key + version for a derive call:
 *   - Me: the user's own key. Version = their own version when they're in no group (exactly
 *     as before). In a group, Me also pairs transfers against other members' transactions
 *     (D12), so the version fingerprints the groups, their members and each member's version
 *     (+1 user read, +1 per group, +1 per other member).
 *   - Group: key "group:<id>" (one cache shared by every member) and a version fingerprint
 *     of the members, the group's own version and each member's version. Membership is
 *     checked here too, so a cache HIT can never serve someone who isn't a member.
 *
 * @module resolvers/periods/view_version
 */
import { TraceContext } from "../../types";
import { DeriveScopeRequest } from "../../domain/periods/derive_scope.service";
export interface ViewVersion {
    /** Cache owner key: the uid for Me, "group:<id>" for a group. */
    view_key: string;
    version: number;
}
/** The cache key for a view, known without any read: the uid for Me, "group:<id>" for a group. */
export declare function view_key_for(caller_id: string, request: DeriveScopeRequest | undefined): string;
export declare function resolve_view_version(ctx: TraceContext, caller_id: string, request: DeriveScopeRequest | undefined): Promise<ViewVersion>;
//# sourceMappingURL=view_version.resolver.d.ts.map