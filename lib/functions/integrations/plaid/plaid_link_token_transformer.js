"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.transform_link_token_response = transform_link_token_response;
exports.create_cached_link_token_response = create_cached_link_token_response;
/**
 * Transforms a raw Plaid LinkTokenCreateResponse to our domain format.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_response - Raw response from Plaid SDK
 * @returns Domain-formatted link token response
 */
function transform_link_token_response(plaid_response) {
    return {
        link_token: plaid_response.link_token,
        expiration: plaid_response.expiration,
        request_id: plaid_response.request_id,
    };
}
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
function create_cached_link_token_response(link_token, expiration) {
    return {
        link_token,
        expiration,
        request_id: "cached",
    };
}
//# sourceMappingURL=plaid_link_token_transformer.js.map