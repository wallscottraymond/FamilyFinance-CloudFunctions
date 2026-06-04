"use strict";
/**
 * Domain Layer
 *
 * Pure business logic services.
 * NO async, NO IO, NO side effects.
 *
 * @module domain
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_delete_budget = exports.compute_update_budget = exports.compute_create_budget = exports.compute_delete_transfer_plan = exports.compute_update_transfer_plan = exports.compute_create_transfer_plan = exports.compute_reallocated_periods = exports.compute_period_generation_end = exports.budget_cadence_to_instance = exports.compute_budget_periods = exports.compute_daily_rate = exports.compute_period_allocation = exports.days_in_month = exports.count_days_inclusive = exports.validate_user_period_summary = exports.compute_user_period_summary = exports.validate_outflow_periods = exports.compute_outflow_periods = exports.compute_monthly_outflow_total = exports.categorize_outflows_by_type = exports.compute_outflow_status = exports.filter_outflows_needing_review = exports.compute_outflow_merge_suggestions = exports.detect_duplicate_outflows = exports.validate_outflows_for_sync = exports.compute_inflow_status = exports.filter_inflows_needing_review = exports.compute_inflow_merge_suggestions = exports.detect_duplicate_inflows = exports.validate_inflows_for_sync = exports.get_link_token_error_message = exports.is_update_mode_request = exports.validate_link_token_request = exports.validate_account_restore = exports.compute_account_removal = exports.determine_removal_type = exports.is_account_already_deleted = exports.check_account_delete_access = exports.check_account_write_access = exports.check_account_read_access = void 0;
var account_service_1 = require("./account.service");
Object.defineProperty(exports, "check_account_read_access", { enumerable: true, get: function () { return account_service_1.check_account_read_access; } });
Object.defineProperty(exports, "check_account_write_access", { enumerable: true, get: function () { return account_service_1.check_account_write_access; } });
Object.defineProperty(exports, "check_account_delete_access", { enumerable: true, get: function () { return account_service_1.check_account_delete_access; } });
Object.defineProperty(exports, "is_account_already_deleted", { enumerable: true, get: function () { return account_service_1.is_account_already_deleted; } });
Object.defineProperty(exports, "determine_removal_type", { enumerable: true, get: function () { return account_service_1.determine_removal_type; } });
Object.defineProperty(exports, "compute_account_removal", { enumerable: true, get: function () { return account_service_1.compute_account_removal; } });
Object.defineProperty(exports, "validate_account_restore", { enumerable: true, get: function () { return account_service_1.validate_account_restore; } });
// Plaid domain services
var plaid_1 = require("./plaid");
Object.defineProperty(exports, "validate_link_token_request", { enumerable: true, get: function () { return plaid_1.validate_link_token_request; } });
Object.defineProperty(exports, "is_update_mode_request", { enumerable: true, get: function () { return plaid_1.is_update_mode_request; } });
Object.defineProperty(exports, "get_link_token_error_message", { enumerable: true, get: function () { return plaid_1.get_link_token_error_message; } });
// Inflow (recurring income) domain services
var inflow_service_1 = require("./inflow.service");
Object.defineProperty(exports, "validate_inflows_for_sync", { enumerable: true, get: function () { return inflow_service_1.validate_inflows_for_sync; } });
Object.defineProperty(exports, "detect_duplicate_inflows", { enumerable: true, get: function () { return inflow_service_1.detect_duplicate_inflows; } });
Object.defineProperty(exports, "compute_inflow_merge_suggestions", { enumerable: true, get: function () { return inflow_service_1.compute_inflow_merge_suggestions; } });
Object.defineProperty(exports, "filter_inflows_needing_review", { enumerable: true, get: function () { return inflow_service_1.filter_inflows_needing_review; } });
Object.defineProperty(exports, "compute_inflow_status", { enumerable: true, get: function () { return inflow_service_1.compute_inflow_status; } });
// Outflow (recurring expense) domain services
var outflow_service_1 = require("./outflow.service");
Object.defineProperty(exports, "validate_outflows_for_sync", { enumerable: true, get: function () { return outflow_service_1.validate_outflows_for_sync; } });
Object.defineProperty(exports, "detect_duplicate_outflows", { enumerable: true, get: function () { return outflow_service_1.detect_duplicate_outflows; } });
Object.defineProperty(exports, "compute_outflow_merge_suggestions", { enumerable: true, get: function () { return outflow_service_1.compute_outflow_merge_suggestions; } });
Object.defineProperty(exports, "filter_outflows_needing_review", { enumerable: true, get: function () { return outflow_service_1.filter_outflows_needing_review; } });
Object.defineProperty(exports, "compute_outflow_status", { enumerable: true, get: function () { return outflow_service_1.compute_outflow_status; } });
Object.defineProperty(exports, "categorize_outflows_by_type", { enumerable: true, get: function () { return outflow_service_1.categorize_outflows_by_type; } });
Object.defineProperty(exports, "compute_monthly_outflow_total", { enumerable: true, get: function () { return outflow_service_1.compute_monthly_outflow_total; } });
// Outflow period domain services
var outflows_1 = require("./outflows");
Object.defineProperty(exports, "compute_outflow_periods", { enumerable: true, get: function () { return outflows_1.compute_outflow_periods; } });
Object.defineProperty(exports, "validate_outflow_periods", { enumerable: true, get: function () { return outflows_1.validate_outflow_periods; } });
// User summary domain services
var summaries_1 = require("./summaries");
Object.defineProperty(exports, "compute_user_period_summary", { enumerable: true, get: function () { return summaries_1.compute_user_period_summary; } });
Object.defineProperty(exports, "validate_user_period_summary", { enumerable: true, get: function () { return summaries_1.validate_user_period_summary; } });
// Budget CRUD domain services
var budgets_1 = require("./budgets");
Object.defineProperty(exports, "count_days_inclusive", { enumerable: true, get: function () { return budgets_1.count_days_inclusive; } });
Object.defineProperty(exports, "days_in_month", { enumerable: true, get: function () { return budgets_1.days_in_month; } });
Object.defineProperty(exports, "compute_period_allocation", { enumerable: true, get: function () { return budgets_1.compute_period_allocation; } });
Object.defineProperty(exports, "compute_daily_rate", { enumerable: true, get: function () { return budgets_1.compute_daily_rate; } });
Object.defineProperty(exports, "compute_budget_periods", { enumerable: true, get: function () { return budgets_1.compute_budget_periods; } });
Object.defineProperty(exports, "budget_cadence_to_instance", { enumerable: true, get: function () { return budgets_1.budget_cadence_to_instance; } });
Object.defineProperty(exports, "compute_period_generation_end", { enumerable: true, get: function () { return budgets_1.compute_period_generation_end; } });
Object.defineProperty(exports, "compute_reallocated_periods", { enumerable: true, get: function () { return budgets_1.compute_reallocated_periods; } });
Object.defineProperty(exports, "compute_create_transfer_plan", { enumerable: true, get: function () { return budgets_1.compute_create_transfer_plan; } });
Object.defineProperty(exports, "compute_update_transfer_plan", { enumerable: true, get: function () { return budgets_1.compute_update_transfer_plan; } });
Object.defineProperty(exports, "compute_delete_transfer_plan", { enumerable: true, get: function () { return budgets_1.compute_delete_transfer_plan; } });
Object.defineProperty(exports, "compute_create_budget", { enumerable: true, get: function () { return budgets_1.compute_create_budget; } });
Object.defineProperty(exports, "compute_update_budget", { enumerable: true, get: function () { return budgets_1.compute_update_budget; } });
Object.defineProperty(exports, "compute_delete_budget", { enumerable: true, get: function () { return budgets_1.compute_delete_budget; } });
//# sourceMappingURL=index.js.map