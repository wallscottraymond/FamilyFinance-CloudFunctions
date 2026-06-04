/**
 * Create Update Link Token Orchestrator
 *
 * Coordinates update link token creation through all required layers.
 * Used for re-authentication when Plaid connections enter error states.
 *
 * @module orchestrators/plaid/create_update_link_token
 */
import { OrchestratorContext, CreateUpdateLinkTokenInput, CreateUpdateLinkTokenOrchestratorResult } from "../../types";
/**
 * Orchestrates update link token creation.
 *
 * Flow:
 * 1. Resolver: Gather dependencies (plaid item, access token, user profile)
 * 2. Domain Service: Validate request (ownership, status, eligibility)
 * 3. Integration Client: Call Plaid API in update mode
 * 4. Transformer: Convert to domain format
 * 5. Repository: Log relink attempt
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with link token or errors
 */
export declare function create_update_link_token_orchestrator(ctx: OrchestratorContext<CreateUpdateLinkTokenInput>): Promise<CreateUpdateLinkTokenOrchestratorResult>;
//# sourceMappingURL=create_update_link_token.orchestrator.d.ts.map