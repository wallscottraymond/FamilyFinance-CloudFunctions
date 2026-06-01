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
export function transform_token_exchange_response(
  plaid_response: ItemPublicTokenExchangeResponse
): TokenExchangeResult {
  return {
    access_token: plaid_response.access_token,
    item_id: plaid_response.item_id,
    request_id: plaid_response.request_id,
  };
}
