"use strict";
/**
 * Callable Entry Points
 *
 * Cloud Functions exposed as callable endpoints.
 *
 * @module entry/callable
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_recurring_reconciliation = exports.backfill_transaction_assignments = exports.sync_recurring = exports.sync_transactions = exports.refresh_plaid_data = exports.link_plaid_account = exports.create_update_link_token = exports.create_link_token = exports.derive_period = exports.derive_recurring_view = exports.list_suppressed_recurring = exports.manage_recurring_inflow = exports.manage_recurring_outflow = exports.derive_recurring_transactions = exports.derive_budget_transactions = exports.derive_budget_view = exports.delete_budget = exports.update_budget = exports.create_budget = exports.purge_user_data = exports.restore_account = exports.remove_account = exports.get_account = exports.get_accounts = void 0;
// Account operations
var get_accounts_entry_1 = require("./get_accounts.entry");
Object.defineProperty(exports, "get_accounts", { enumerable: true, get: function () { return get_accounts_entry_1.get_accounts; } });
Object.defineProperty(exports, "get_account", { enumerable: true, get: function () { return get_accounts_entry_1.get_account; } });
var remove_account_entry_1 = require("./remove_account.entry");
Object.defineProperty(exports, "remove_account", { enumerable: true, get: function () { return remove_account_entry_1.remove_account; } });
var restore_account_entry_1 = require("./restore_account.entry");
Object.defineProperty(exports, "restore_account", { enumerable: true, get: function () { return restore_account_entry_1.restore_account; } });
// User operations
var purge_user_data_entry_1 = require("./purge_user_data.entry");
Object.defineProperty(exports, "purge_user_data", { enumerable: true, get: function () { return purge_user_data_entry_1.purge_user_data; } });
// Budget CRUD operations (layered architecture v2)
var create_budget_entry_1 = require("./create_budget.entry");
Object.defineProperty(exports, "create_budget", { enumerable: true, get: function () { return create_budget_entry_1.create_budget; } });
var update_budget_entry_1 = require("./update_budget.entry");
Object.defineProperty(exports, "update_budget", { enumerable: true, get: function () { return update_budget_entry_1.update_budget; } });
var delete_budget_entry_1 = require("./delete_budget.entry");
Object.defineProperty(exports, "delete_budget", { enumerable: true, get: function () { return delete_budget_entry_1.delete_budget; } });
// Derive-On-Read Period Architecture (Phase 1): budget view derivation
var derive_budget_view_entry_1 = require("./derive_budget_view.entry");
Object.defineProperty(exports, "derive_budget_view", { enumerable: true, get: function () { return derive_budget_view_entry_1.derive_budget_view; } });
// Budget-detail transactions (on-read owner + derived status; ignored/transfers section)
var derive_budget_transactions_entry_1 = require("./derive_budget_transactions.entry");
Object.defineProperty(exports, "derive_budget_transactions", { enumerable: true, get: function () { return derive_budget_transactions_entry_1.derive_budget_transactions; } });
// Recurring inflow/outflow detail transactions (this-period + historical)
var derive_recurring_transactions_entry_1 = require("./derive_recurring_transactions.entry");
Object.defineProperty(exports, "derive_recurring_transactions", { enumerable: true, get: function () { return derive_recurring_transactions_entry_1.derive_recurring_transactions; } });
// Remove-Recover-Recurring: remove / pause / restore / delete a recurring bill / income
var manage_recurring_outflow_entry_1 = require("./manage_recurring_outflow.entry");
Object.defineProperty(exports, "manage_recurring_outflow", { enumerable: true, get: function () { return manage_recurring_outflow_entry_1.manage_recurring_outflow; } });
var manage_recurring_inflow_entry_1 = require("./manage_recurring_inflow.entry");
Object.defineProperty(exports, "manage_recurring_inflow", { enumerable: true, get: function () { return manage_recurring_inflow_entry_1.manage_recurring_inflow; } });
// Recovery screen: list currently removed/paused recurring items
var list_suppressed_recurring_entry_1 = require("./list_suppressed_recurring.entry");
Object.defineProperty(exports, "list_suppressed_recurring", { enumerable: true, get: function () { return list_suppressed_recurring_entry_1.list_suppressed_recurring; } });
// Derive-On-Read Period Architecture (Phase 3): bill/income view derivation
var derive_recurring_view_entry_1 = require("./derive_recurring_view.entry");
Object.defineProperty(exports, "derive_recurring_view", { enumerable: true, get: function () { return derive_recurring_view_entry_1.derive_recurring_view; } });
// Derive-On-Read Period Architecture: BATCHED whole-period derivation (one call)
var derive_period_entry_1 = require("./derive_period.entry");
Object.defineProperty(exports, "derive_period", { enumerable: true, get: function () { return derive_period_entry_1.derive_period; } });
// Plaid operations
var create_link_token_entry_1 = require("./create_link_token.entry");
Object.defineProperty(exports, "create_link_token", { enumerable: true, get: function () { return create_link_token_entry_1.create_link_token; } });
var create_update_link_token_entry_1 = require("./create_update_link_token.entry");
Object.defineProperty(exports, "create_update_link_token", { enumerable: true, get: function () { return create_update_link_token_entry_1.create_update_link_token; } });
var link_plaid_account_entry_1 = require("./link_plaid_account.entry");
Object.defineProperty(exports, "link_plaid_account", { enumerable: true, get: function () { return link_plaid_account_entry_1.link_plaid_account; } });
var refresh_plaid_data_entry_1 = require("./refresh_plaid_data.entry");
Object.defineProperty(exports, "refresh_plaid_data", { enumerable: true, get: function () { return refresh_plaid_data_entry_1.refresh_plaid_data; } });
var sync_transactions_entry_1 = require("./sync_transactions.entry");
Object.defineProperty(exports, "sync_transactions", { enumerable: true, get: function () { return sync_transactions_entry_1.sync_transactions; } });
var sync_recurring_entry_1 = require("./sync_recurring.entry");
Object.defineProperty(exports, "sync_recurring", { enumerable: true, get: function () { return sync_recurring_entry_1.sync_recurring; } });
// Transaction Assignment Engine: one-shot post-cutover backfill
var backfill_transaction_assignments_entry_1 = require("./backfill_transaction_assignments.entry");
Object.defineProperty(exports, "backfill_transaction_assignments", { enumerable: true, get: function () { return backfill_transaction_assignments_entry_1.backfill_transaction_assignments; } });
var backfill_recurring_reconciliation_entry_1 = require("./backfill_recurring_reconciliation.entry");
Object.defineProperty(exports, "backfill_recurring_reconciliation", { enumerable: true, get: function () { return backfill_recurring_reconciliation_entry_1.backfill_recurring_reconciliation; } });
//# sourceMappingURL=index.js.map