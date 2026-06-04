/**
 * Link Plaid Account Entry Point
 *
 * Cloud Function entry for the complete Plaid Link flow.
 * Called after user completes Plaid Link to:
 * 1. Exchange the public token for access token
 * 2. Save the Plaid item
 * 3. Link accounts
 *
 * @module entry/callable/link_plaid_account
 */
import { FunctionResponse, LinkPlaidAccountResponse } from "../../types";
/**
 * Link a Plaid account - complete flow.
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator (exchange + save item + link accounts)
 * 5. Returns the result
 *
 * @param request.data.public_token - Public token from Plaid Link
 * @param request.data.institution_id - Institution ID from metadata
 * @param request.data.institution_name - Institution name from metadata
 * @param request.data.link_session_id - Link session ID for idempotency
 * @param request.data.debug_mode - Enable verbose logging (optional)
 * @returns Result with item_id and linked account info
 */
export declare const link_plaid_account: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<LinkPlaidAccountResponse>>, unknown>;
//# sourceMappingURL=link_plaid_account.entry.d.ts.map