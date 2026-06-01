/**
 * Account Resolver
 *
 * Determines what entities are affected by account changes.
 * READ-ONLY impact analysis - no mutations.
 *
 * @module resolvers/account
 */

import { TraceContext, DependencyResult } from "../types";
import { create_span, log_operation_start, log_operation_success } from "../observability";
import { transaction_repo } from "../repositories/transaction.repo";
import { outflow_repo } from "../repositories/outflow.repo";
import { inflow_repo } from "../repositories/inflow.repo";
import { account_repo } from "../repositories/account.repo";

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
export async function resolve_account_removal_dependencies(
  ctx: TraceContext,
  account_id: string,
  user_id: string
): Promise<AccountRemovalDependencyResult> {
  const span = create_span(ctx, "resolver", "resolve_account_removal_dependencies");
  log_operation_start(span, user_id);

  const affected_entities: string[] = [];

  // 1. Get the account to retrieve its Plaid account ID and item ID
  const account = await account_repo.get_by_id(ctx, account_id, { include_deleted: true });

  if (!account) {
    // Account not found - return empty result
    log_operation_success(span, user_id);
    return {
      affected_entities: [],
      recomputation_scope: "none",
      consistency_risk: "low",
      required_rebuild: false,
      transaction_count: 0,
      transaction_ids: [],
      outflow_ids: [],
      inflow_ids: [],
      other_active_accounts_count: 0,
      item_id: "",
    };
  }

  const plaid_account_id = account.account_id;
  const item_id = account.item_id;

  // 2. Count and get transaction IDs for this account
  const transaction_count = await transaction_repo.count_by_account_id(
    ctx,
    plaid_account_id,
    user_id
  );
  // Get a sample of transaction IDs for reference (full cascade will query again)
  const transaction_ids = await transaction_repo.get_ids_by_account_id(
    ctx,
    plaid_account_id,
    user_id,
    100 // Limit to 100 for resolver - cascade job will handle all
  );
  transaction_ids.forEach(id => affected_entities.push(`transaction:${id}`));

  // 3. Get recurring outflows for this account
  const outflows = await outflow_repo.get_by_account_id(ctx, plaid_account_id);
  const outflow_ids = outflows.map(o => o.id);
  outflow_ids.forEach(id => affected_entities.push(`outflow:${id}`));

  // 4. Get recurring inflows for this account
  const inflows = await inflow_repo.get_by_account_id(ctx, plaid_account_id);
  const inflow_ids = inflows.map(i => i.id);
  inflow_ids.forEach(id => affected_entities.push(`inflow:${id}`));

  // 5. Count other active accounts for the same Plaid item
  // This determines whether to call Plaid API (full item removal) or local-only
  const all_item_accounts = await account_repo.get_by_item_id(ctx, item_id);
  const other_active_accounts = all_item_accounts.filter(
    a => a.id !== account_id && a.is_active
  );
  const other_active_accounts_count = other_active_accounts.length;

  log_operation_success(span, user_id);

  // Classify recomputation scope based on affected count
  const total_affected = transaction_count + outflow_ids.length + inflow_ids.length;
  const recomputation_scope = total_affected === 0
    ? "none"
    : total_affected <= 10
      ? "single"
      : "batch";

  // High consistency risk if many transactions affected
  const consistency_risk = transaction_count > 100 ? "high" : total_affected > 10 ? "medium" : "low";

  console.log(
    `[${ctx.trace_id}] resolve_account_removal_dependencies: ` +
    `transactions=${transaction_count}, outflows=${outflow_ids.length}, ` +
    `inflows=${inflow_ids.length}, other_accounts=${other_active_accounts_count}`
  );

  return {
    affected_entities,
    recomputation_scope,
    consistency_risk,
    required_rebuild: false,
    transaction_count,
    transaction_ids,
    outflow_ids,
    inflow_ids,
    other_active_accounts_count,
    item_id,
  };
}

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
export async function resolve_account_balance_update_dependencies(
  ctx: TraceContext,
  account_id: string,
  user_id: string
): Promise<DependencyResult> {
  const span = create_span(ctx, "resolver", "resolve_account_balance_update_dependencies");
  log_operation_start(span, user_id);

  // Balance updates affect summaries but not transactions/budgets
  const affected_entities: string[] = [
    `account_summary:${account_id}`,
    `net_worth:${user_id}`,
  ];

  log_operation_success(span, user_id);

  return {
    affected_entities,
    recomputation_scope: "single",
    consistency_risk: "low",
    required_rebuild: false,
  };
}
