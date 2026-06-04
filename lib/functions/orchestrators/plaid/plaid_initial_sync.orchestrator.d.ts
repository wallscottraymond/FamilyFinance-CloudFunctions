/**
 * Plaid Initial Sync Orchestrator
 *
 * Coordinates the complete initial data sync when a Plaid item is created:
 * 1. Create accounts (with balances from Plaid)
 * 2. Sync transactions
 * 3. Sync recurring transactions (inflows/outflows)
 *
 * This follows the 5-layer architecture with the trigger entry calling
 * exactly ONE orchestrator.
 *
 * @module orchestrators/plaid/plaid_initial_sync
 */
import { OrchestratorContext, InitialSyncInput, InitialSyncOrchestratorResult } from "../../types";
/**
 * Orchestrates the complete initial sync when a Plaid item is created.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Resolve dependencies (plaid_item, user groups, institution)
 * 3. Domain validation
 * 4. PHASE 1: Create accounts (with balances)
 * 5. PHASE 2: Sync transactions (wraps legacy function)
 * 6. PHASE 3: Sync recurring (wraps legacy function)
 * 7. Update plaid_item with sync timestamps
 * 8. Complete idempotency key
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with sync statistics
 */
export declare function plaid_initial_sync_orchestrator(ctx: OrchestratorContext<InitialSyncInput>): Promise<InitialSyncOrchestratorResult>;
//# sourceMappingURL=plaid_initial_sync.orchestrator.d.ts.map