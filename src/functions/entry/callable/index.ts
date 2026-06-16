/**
 * Callable Entry Points
 *
 * Cloud Functions exposed as callable endpoints.
 *
 * @module entry/callable
 */

// Account operations
export { get_accounts, get_account } from "./get_accounts.entry";
export { remove_account } from "./remove_account.entry";
export { restore_account } from "./restore_account.entry";

// Budget CRUD operations (layered architecture v2)
export { create_budget } from "./create_budget.entry";
export { update_budget } from "./update_budget.entry";
export { delete_budget } from "./delete_budget.entry";

// Plaid operations
export { create_link_token } from "./create_link_token.entry";
export { create_update_link_token } from "./create_update_link_token.entry";
export { link_plaid_account } from "./link_plaid_account.entry";
export { refresh_plaid_data } from "./refresh_plaid_data.entry";
export { sync_transactions } from "./sync_transactions.entry";
export { sync_recurring } from "./sync_recurring.entry";

// Transaction Assignment Engine: one-shot post-cutover backfill
export {
  backfill_transaction_assignments,
} from "./backfill_transaction_assignments.entry";
export {
  backfill_recurring_reconciliation,
} from "./backfill_recurring_reconciliation.entry";
