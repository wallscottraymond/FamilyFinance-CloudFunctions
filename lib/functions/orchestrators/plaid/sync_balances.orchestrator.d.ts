/**
 * Sync Balances Orchestrator
 *
 * Coordinates the balance synchronization flow:
 * 1. Resolver: Get items with access tokens
 * 2. Integration: Fetch accounts/balances from Plaid
 * 3. Repository: Upsert accounts (create if new, update balances if exists)
 * 4. Events: Emit balance_updated events for changes
 *
 * Uses the same upsert logic as initial sync for consistency.
 *
 * @module orchestrators/plaid/sync_balances
 */
import { OrchestratorContext } from "../../types";
import { SyncBalancesInput, SyncBalancesResponse } from "../../types/plaid";
/**
 * Orchestrates the balance synchronization flow.
 *
 * Uses the same upsert_from_plaid() method as initial sync to ensure
 * consistent behavior: creates accounts if they don't exist, updates
 * balances if they do.
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Sync results with updated account counts
 */
export declare function sync_balances_orchestrator(ctx: OrchestratorContext<SyncBalancesInput>): Promise<SyncBalancesResponse>;
//# sourceMappingURL=sync_balances.orchestrator.d.ts.map