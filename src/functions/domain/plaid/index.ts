/**
 * Plaid Domain Services Index
 *
 * Re-exports all Plaid-related domain services.
 *
 * @module domain/plaid
 */

export {
  validate_link_token_request,
  is_update_mode_request,
  get_link_token_error_message,
} from "./link_token.service";

export {
  validate_link_account_request,
  validate_plaid_item_for_creation,
  get_link_account_error_message,
} from "./link_plaid_account.service";

export {
  validate_initial_sync,
  should_continue_after_failure,
  aggregate_sync_results,
  create_success_phase_result,
  create_failure_phase_result,
} from "./initial_sync.service";

export {
  validate_balance_updates,
  create_account_success_result,
  create_account_failure_result,
  create_item_success_result,
  create_item_failure_result,
  aggregate_balance_sync_results,
} from "./balance_sync.service";

export {
  validate_transactions_for_sync,
  detect_material_changes,
  calculate_proportional_splits,
  merge_pending_to_posted,
  aggregate_transaction_sync_results,
  should_continue_sync,
  normalize_amount,
  determine_transaction_type,
} from "./transaction_sync.service";
