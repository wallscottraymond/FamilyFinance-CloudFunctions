/**
 * Create Update Link Token Entry Point
 *
 * Cloud Function entry for creating Plaid Link tokens in update mode.
 * Used for re-authentication when bank connections enter error states.
 *
 * @module entry/callable/create_update_link_token
 */
import { FunctionResponse } from "../../types";
import { CreateUpdateLinkTokenResponse } from "../../types/plaid/update_link_token.types";
/**
 * Create a Plaid Link token for re-authentication (update mode).
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator
 * 5. Returns the link token for update mode
 *
 * Used when:
 * - User's bank connection enters error state (ITEM_LOGIN_REQUIRED)
 * - OAuth consent is expiring (PENDING_EXPIRATION)
 * - User wants to proactively re-authenticate
 *
 * @param request.data.item_id - The Plaid item document ID
 * @param request.data.idempotency_key - UUID to prevent duplicate requests
 * @param request.data.debug_mode - Enable verbose logging. Optional.
 * @returns Link token response for update mode
 */
export declare const create_update_link_token: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<CreateUpdateLinkTokenResponse>>, unknown>;
//# sourceMappingURL=create_update_link_token.entry.d.ts.map