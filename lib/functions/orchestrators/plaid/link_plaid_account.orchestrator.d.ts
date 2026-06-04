/**
 * Link Plaid Account Orchestrator
 *
 * Coordinates the complete Plaid Link flow:
 * 1. Check idempotency
 * 2. Resolve dependencies
 * 3. Validate request (domain)
 * 4. Exchange public token for access token (integration)
 * 5. Validate Plaid item (domain)
 * 6. Save Plaid item (repository)
 * 7. Emit events
 *
 * Account syncing is handled by the onPlaidItemCreated trigger.
 *
 * @module orchestrators/plaid/link_plaid_account
 */
import { OrchestratorContext, LinkPlaidAccountInput, LinkPlaidAccountOrchestratorResult } from "../../types";
/**
 * Orchestrates the complete Plaid Link flow.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Resolver: Gather dependencies (user groups, duplicate check)
 * 3. Domain Service: Validate request
 * 4. Integration Client: Exchange public token for access token
 * 5. Domain Service: Validate Plaid item for creation
 * 6. Repository: Save Plaid item (with encrypted token)
 * 7. Emit events
 *
 * Note: Account syncing is handled by the onPlaidItemCreated trigger.
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with item data
 */
export declare function link_plaid_account_orchestrator(ctx: OrchestratorContext<LinkPlaidAccountInput>): Promise<LinkPlaidAccountOrchestratorResult>;
//# sourceMappingURL=link_plaid_account.orchestrator.d.ts.map