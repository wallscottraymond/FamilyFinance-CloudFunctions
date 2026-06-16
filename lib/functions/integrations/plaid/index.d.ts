/**
 * Plaid Integration Layer
 *
 * Provides access to Plaid API through:
 * - Client: API calls with retry logic
 * - Transformer: Pure data conversion functions
 *
 * @module integrations/plaid
 */
export { PlaidAccountsResult, PlaidInstitutionInfo, RemoveItemResult, fetch_plaid_accounts, fetch_plaid_balances, create_link_token, exchange_public_token, sync_transactions, fetch_recurring_transactions, remove_item, } from "./plaid_client";
export { PlaidAccountData, AccountForPersistence, TransformContext, plaid_accounts_to_data, transform_plaid_accounts_to_domain, transform_plaid_balances_to_updates, get_account_category, } from "./plaid_transformer";
export { transform_link_token_response, create_cached_link_token_response, } from "./plaid_link_token_transformer";
export { transform_token_exchange_response, } from "./plaid_token_exchange_transformer";
export { TransactionTransformContext, transform_plaid_transactions_to_domain, identify_pending_migrations, extract_removed_transaction_ids, has_material_changes, get_changed_fields, map_plaid_category_to_internal, } from "./plaid_transaction_transformer";
export { transform_legacy_to_persistence, } from "./legacy_transaction_transformer";
export { AppFrequency, RecurringStatus, RecurringSource, RecurringTransformContext, InflowForPersistence, OutflowForPersistence, map_plaid_frequency_to_app, transform_inflow_streams, transform_outflow_streams, calculate_next_due_date, } from "./plaid_recurring_transformer";
//# sourceMappingURL=index.d.ts.map