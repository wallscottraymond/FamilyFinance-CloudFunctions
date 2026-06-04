/**
 * Plaid Token Exchange Transformer
 *
 * Pure transformation functions for converting Plaid token exchange responses
 * to domain format.
 *
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module integrations/plaid/plaid_token_exchange_transformer
 */
import { ItemPublicTokenExchangeResponse } from "plaid";
import { TokenExchangeResult } from "../../types/plaid";
/**
 * Transforms a raw Plaid ItemPublicTokenExchangeResponse to domain format.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * Note: The access_token should be encrypted before storage.
 *
 * @param plaid_response - Raw response from Plaid SDK
 * @returns Domain-formatted token exchange result
 */
export declare function transform_token_exchange_response(plaid_response: ItemPublicTokenExchangeResponse): TokenExchangeResult;
//# sourceMappingURL=plaid_token_exchange_transformer.d.ts.map