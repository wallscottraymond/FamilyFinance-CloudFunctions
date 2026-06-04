/**
 * Create Link Token Entry Point
 *
 * Cloud Function entry for creating Plaid Link tokens.
 * Enables users to connect bank accounts via Plaid Link.
 *
 * @module entry/callable/create_link_token
 */
import { FunctionResponse, CreateLinkTokenResponse } from "../../types";
/**
 * Create a Plaid Link token for account connection.
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator
 * 5. Returns the link token
 *
 * Supports:
 * - Normal mode: Create link token for new account connection
 * - Update mode: Create link token for re-authentication (when credentials expire)
 *
 * @param request.data.access_token - For update mode (re-auth). Optional.
 * @param request.data.redirect_uri - For OAuth flows. Optional.
 * @param request.data.debug_mode - Enable verbose logging. Optional.
 * @returns Link token response
 */
export declare const create_link_token: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<CreateLinkTokenResponse>>, unknown>;
//# sourceMappingURL=create_link_token.entry.d.ts.map