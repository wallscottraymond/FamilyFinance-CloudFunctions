/**
 * Plaid Link Token Transformer
 *
 * Pure transformation functions for converting Plaid link token responses
 * to domain format.
 *
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module integrations/plaid/plaid_link_token_transformer
 */
import { LinkTokenCreateResponse } from "plaid";
import { CreateLinkTokenResponse } from "../../types/plaid";
/**
 * Transforms a raw Plaid LinkTokenCreateResponse to our domain format.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_response - Raw response from Plaid SDK
 * @returns Domain-formatted link token response
 */
export declare function transform_link_token_response(plaid_response: LinkTokenCreateResponse): CreateLinkTokenResponse;
/**
 * Creates a cached response format.
 *
 * Used when returning a token from cache rather than from Plaid.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param link_token - Cached link token
 * @param expiration - Cached expiration
 * @returns Domain-formatted response with 'cached' request_id
 */
export declare function create_cached_link_token_response(link_token: string, expiration: string): CreateLinkTokenResponse;
//# sourceMappingURL=plaid_link_token_transformer.d.ts.map