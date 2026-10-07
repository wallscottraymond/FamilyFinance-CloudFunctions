/**
 * Re-authentication Item Resolver
 *
 * READ-ONLY: loads Plaid items needing re-authentication with their decrypted
 * access tokens, for the recovery probe. No mutations.
 *
 * @module resolvers/plaid/reauth_item
 */
import { TraceContext } from "../../types";
import { ReauthItem } from "../../types/plaid/reauth_recovery.types";
/**
 * Resolves one item by document ID.
 *
 * @param ctx - Trace context
 * @param item_doc_id - Plaid item document ID
 * @returns The item, or null when it doesn't exist
 */
export declare function resolve_reauth_item(ctx: TraceContext, item_doc_id: string): Promise<ReauthItem | null>;
/**
 * Resolves every active item currently needing re-authentication (capped).
 *
 * @param ctx - Trace context
 * @returns Items to probe
 */
export declare function resolve_reauth_items_to_probe(ctx: TraceContext): Promise<ReauthItem[]>;
//# sourceMappingURL=reauth_item.resolver.d.ts.map