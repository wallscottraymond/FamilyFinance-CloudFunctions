/**
 * Account Resolver
 *
 * Determines what entities are affected by account changes.
 * READ-ONLY impact analysis - no mutations.
 *
 * @module resolvers/account
 */
import { TraceContext, DependencyResult } from "../types";
/**
 * Result of resolving account removal dependencies.
 * Extends base DependencyResult with additional context.
 */
export interface AccountRemovalDependencyResult extends DependencyResult {
    /** Number of transactions linked to this account */
    transaction_count: number;
    /** IDs of transactions to hide (limited sample for cascade job reference) */
    transaction_ids: string[];
    /** IDs of recurring outflows to soft-delete */
    outflow_ids: string[];
    /** IDs of recurring inflows to soft-delete */
    inflow_ids: string[];
    /** Number of other active accounts for the same Plaid item */
    other_active_accounts_count: number;
    /** Plaid item ID for this account */
    item_id: string;
}
/**
 * Resolves dependencies affected by account removal.
 *
 * When an account is removed, the following may be affected:
 * - Transactions linked to this account (should be hidden)
 * - Recurring outflows from this account (should be soft-deleted)
 * - Recurring inflows to this account (should be soft-deleted)
 * - Other accounts for the same Plaid item (determines removal type)
 *
 * This resolver performs READ-ONLY operations to determine cascade scope.
 *
 * @param ctx - Trace context
 * @param account_id - Document ID of the account being removed
 * @param user_id - User performing the removal
 * @returns Dependency result with affected entities and counts
 */
export declare function resolve_account_removal_dependencies(ctx: TraceContext, account_id: string, user_id: string): Promise<AccountRemovalDependencyResult>;
/**
 * Resolves dependencies for account balance update.
 *
 * When account balance changes:
 * - Net worth calculations need refresh
 * - Account summaries need update
 * - Cashflow projections may need recalculation
 *
 * @param ctx - Trace context
 * @param account_id - Account being updated
 * @param user_id - User context
 * @returns Dependency result
 */
export declare function resolve_account_balance_update_dependencies(ctx: TraceContext, account_id: string, user_id: string): Promise<DependencyResult>;
//# sourceMappingURL=account.resolver.d.ts.map