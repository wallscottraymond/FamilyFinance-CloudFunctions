/**
 * Resolver Layer
 *
 * Determines what entities are affected by changes.
 * READ-ONLY impact analysis - no mutations.
 *
 * @module resolvers
 */

export {
  AccountRemovalDependencyResult,
  resolve_account_removal_dependencies,
  resolve_account_balance_update_dependencies,
} from "./account.resolver";

// Plaid resolvers
export { resolve_link_token_dependencies } from "./plaid";

// Outflow resolvers
export {
  ResolveOutflowPeriodInput,
  OutflowPeriodDependencies,
  resolve_outflow_period_dependencies,
  resolve_outflow_period_dependencies_from_doc,
} from "./outflows";

// Summary resolvers
export {
  ResolveUserSummaryInput,
  UserSummaryDependencies,
  resolve_user_summary_dependencies,
  batch_resolve_user_summary_dependencies,
} from "./summaries";

// Budget resolvers
export {
  resolve_create_budget_dependencies,
  resolve_update_budget_dependencies,
  resolve_delete_budget_dependencies,
} from "./budgets";
