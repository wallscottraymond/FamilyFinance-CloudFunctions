/**
 * Refresh Plaid Data Orchestrator
 *
 * Coordinates the combined balance + transaction sync flow
 * triggered by pull-to-refresh in the mobile app.
 *
 * Flow:
 * 1. Resolve dependencies (items, user context)
 * 2. Sync balances for all items
 * 3. Sync transactions for each item
 * 4. Aggregate results
 * 5. Update sync timestamps
 *
 * @module orchestrators/plaid/refresh_plaid_data
 */
import { OrchestratorContext } from "../../types";
import { RefreshPlaidDataInput, RefreshPlaidDataResponse } from "../../types/plaid/refresh_plaid_data.types";
/**
 * Orchestrates the combined balance + transaction refresh.
 *
 * This orchestrator:
 * 1. Syncs balances first (creates/updates accounts)
 * 2. Syncs transactions for each Plaid item
 * 3. Returns aggregated results
 *
 * Balance sync failures are critical and abort the operation.
 * Transaction sync failures are logged but don't abort (partial success).
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Combined sync results
 */
export declare function refresh_plaid_data_orchestrator(ctx: OrchestratorContext<RefreshPlaidDataInput>): Promise<RefreshPlaidDataResponse>;
//# sourceMappingURL=refresh_plaid_data.orchestrator.d.ts.map