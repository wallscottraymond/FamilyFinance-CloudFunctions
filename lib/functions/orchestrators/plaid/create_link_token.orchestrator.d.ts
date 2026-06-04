/**
 * Create Link Token Orchestrator
 *
 * Coordinates link token creation through all required layers.
 * Includes token caching to reduce Plaid API calls.
 *
 * @module orchestrators/plaid/create_link_token
 */
import { OrchestratorContext, CreateLinkTokenInput, CreateLinkTokenOrchestratorResult } from "../../types";
/**
 * Orchestrates link token creation.
 *
 * Flow:
 * 1. Resolver: Gather dependencies (user profile, cache, item count)
 * 2. Domain Service: Validate request
 * 3. Check cache: Return cached token if available
 * 4. Integration Client: Call Plaid API
 * 5. Transformer: Convert to domain format
 * 6. Repository: Log event for audit + cache
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with link token or errors
 */
export declare function create_link_token_orchestrator(ctx: OrchestratorContext<CreateLinkTokenInput>): Promise<CreateLinkTokenOrchestratorResult>;
//# sourceMappingURL=create_link_token.orchestrator.d.ts.map