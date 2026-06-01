/**
 * Repository Layer
 *
 * Pure persistence layer with no business logic.
 * All writes are automatically audited.
 *
 * @module repositories
 */

// Business domain repositories
export { Account, account_repo } from "./account.repo";
export { transaction_repo } from "./transaction.repo";
export {
  outflow_period_repo,
  OutflowPeriodUpdate,
  OutflowPeriodForPersistence,
} from "./outflow_period.repo";
export { inflow_period_repo, InflowPeriodForPersistence } from "./inflow_period.repo";
export { Inflow, inflow_repo } from "./inflow.repo";
export { Outflow, outflow_repo } from "./outflow.repo";
export { budget_repo } from "./budget.repo";
export { budget_period_repo } from "./budget_period.repo";
export { source_period_repo, SourcePeriodEntity } from "./source_period.repo";

// Plaid repositories
export { link_token_event_repo } from "./plaid";

// Infrastructure repositories (re-export)
export * from "./infrastructure";
