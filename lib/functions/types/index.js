"use strict";
/**
 * Type System Index
 *
 * Re-exports all types for convenient importing.
 *
 * @example
 * import {
 *   TraceContext,
 *   DomainResult,
 *   WriteResult,
 *   ValidationError
 * } from "../types";
 *
 * @module types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_ERROR_MESSAGES = exports.STATUSES_REQUIRING_REAUTH = exports.CREATE_UPDATE_LINK_TOKEN_BUDGET = exports.RELINK_ATTEMPT_RETENTION_DAYS = exports.RELINK_ATTEMPT_WINDOW_HOURS = exports.MAX_RELINK_ATTEMPTS_BEFORE_HELP = exports.INITIAL_SYNC_BUDGET = exports.LINK_PLAID_ACCOUNT_BUDGET = exports.CREATE_LINK_TOKEN_BUDGET = exports.LINK_TOKEN_CACHE_TTL_HOURS = exports.get_user_message = exports.USER_ERROR_MESSAGES = exports.accepted_response = exports.error_response = exports.success_response = exports.get_https_error_code = exports.get_http_status = exports.AlreadyProcessedError = exports.TimeoutError = exports.ExternalServiceError = exports.RateLimitExceededError = exports.PermissionDeniedError = exports.NotFoundError = exports.PerformanceBudgetExceededError = exports.IdempotencyConflictError = exports.ValidationError = exports.DomainError = exports.create_change_event = exports.create_event = exports.merge_dependencies = exports.full_rebuild = exports.batch_dependencies = exports.single_dependency = exports.no_dependencies = exports.chunk_for_batch = exports.FIRESTORE_BATCH_LIMIT = exports.create_write_result = exports.compute_hash = exports.combine_results = exports.get_entities = exports.has_entities = exports.has_errors = exports.partial_success = exports.validation_failed = exports.success_many = exports.success = exports.is_budget_exceeded = exports.update_elapsed_time = exports.create_performance_metrics = exports.DEFAULT_PERFORMANCE_BUDGET = void 0;
exports.DELETE_BUDGET_BUDGET = exports.delete_budget_input_schema = exports.UPDATE_BUDGET_BUDGET = exports.EVERYTHING_ELSE_EDITABLE_FIELDS = exports.update_budget_input_schema = exports.CREATE_BUDGET_BUDGET = exports.MAX_BUDGETS_PER_USER = exports.create_budget_input_schema = void 0;
// Context types
var context_1 = require("./context");
Object.defineProperty(exports, "DEFAULT_PERFORMANCE_BUDGET", { enumerable: true, get: function () { return context_1.DEFAULT_PERFORMANCE_BUDGET; } });
Object.defineProperty(exports, "create_performance_metrics", { enumerable: true, get: function () { return context_1.create_performance_metrics; } });
Object.defineProperty(exports, "update_elapsed_time", { enumerable: true, get: function () { return context_1.update_elapsed_time; } });
Object.defineProperty(exports, "is_budget_exceeded", { enumerable: true, get: function () { return context_1.is_budget_exceeded; } });
// Domain result types
var domain_1 = require("./domain");
Object.defineProperty(exports, "success", { enumerable: true, get: function () { return domain_1.success; } });
Object.defineProperty(exports, "success_many", { enumerable: true, get: function () { return domain_1.success_many; } });
Object.defineProperty(exports, "validation_failed", { enumerable: true, get: function () { return domain_1.validation_failed; } });
Object.defineProperty(exports, "partial_success", { enumerable: true, get: function () { return domain_1.partial_success; } });
Object.defineProperty(exports, "has_errors", { enumerable: true, get: function () { return domain_1.has_errors; } });
Object.defineProperty(exports, "has_entities", { enumerable: true, get: function () { return domain_1.has_entities; } });
Object.defineProperty(exports, "get_entities", { enumerable: true, get: function () { return domain_1.get_entities; } });
Object.defineProperty(exports, "combine_results", { enumerable: true, get: function () { return domain_1.combine_results; } });
// Repository types
var repository_1 = require("./repository");
Object.defineProperty(exports, "compute_hash", { enumerable: true, get: function () { return repository_1.compute_hash; } });
Object.defineProperty(exports, "create_write_result", { enumerable: true, get: function () { return repository_1.create_write_result; } });
Object.defineProperty(exports, "FIRESTORE_BATCH_LIMIT", { enumerable: true, get: function () { return repository_1.FIRESTORE_BATCH_LIMIT; } });
Object.defineProperty(exports, "chunk_for_batch", { enumerable: true, get: function () { return repository_1.chunk_for_batch; } });
// Dependency types
var dependency_1 = require("./dependency");
Object.defineProperty(exports, "no_dependencies", { enumerable: true, get: function () { return dependency_1.no_dependencies; } });
Object.defineProperty(exports, "single_dependency", { enumerable: true, get: function () { return dependency_1.single_dependency; } });
Object.defineProperty(exports, "batch_dependencies", { enumerable: true, get: function () { return dependency_1.batch_dependencies; } });
Object.defineProperty(exports, "full_rebuild", { enumerable: true, get: function () { return dependency_1.full_rebuild; } });
Object.defineProperty(exports, "merge_dependencies", { enumerable: true, get: function () { return dependency_1.merge_dependencies; } });
// Event types
var events_1 = require("./events");
Object.defineProperty(exports, "create_event", { enumerable: true, get: function () { return events_1.create_event; } });
Object.defineProperty(exports, "create_change_event", { enumerable: true, get: function () { return events_1.create_change_event; } });
// Error types
var errors_1 = require("./errors");
Object.defineProperty(exports, "DomainError", { enumerable: true, get: function () { return errors_1.DomainError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_1.ValidationError; } });
Object.defineProperty(exports, "IdempotencyConflictError", { enumerable: true, get: function () { return errors_1.IdempotencyConflictError; } });
Object.defineProperty(exports, "PerformanceBudgetExceededError", { enumerable: true, get: function () { return errors_1.PerformanceBudgetExceededError; } });
Object.defineProperty(exports, "NotFoundError", { enumerable: true, get: function () { return errors_1.NotFoundError; } });
Object.defineProperty(exports, "PermissionDeniedError", { enumerable: true, get: function () { return errors_1.PermissionDeniedError; } });
Object.defineProperty(exports, "RateLimitExceededError", { enumerable: true, get: function () { return errors_1.RateLimitExceededError; } });
Object.defineProperty(exports, "ExternalServiceError", { enumerable: true, get: function () { return errors_1.ExternalServiceError; } });
Object.defineProperty(exports, "TimeoutError", { enumerable: true, get: function () { return errors_1.TimeoutError; } });
Object.defineProperty(exports, "AlreadyProcessedError", { enumerable: true, get: function () { return errors_1.AlreadyProcessedError; } });
Object.defineProperty(exports, "get_http_status", { enumerable: true, get: function () { return errors_1.get_http_status; } });
Object.defineProperty(exports, "get_https_error_code", { enumerable: true, get: function () { return errors_1.get_https_error_code; } });
// Response types
var response_1 = require("./response");
Object.defineProperty(exports, "success_response", { enumerable: true, get: function () { return response_1.success_response; } });
Object.defineProperty(exports, "error_response", { enumerable: true, get: function () { return response_1.error_response; } });
Object.defineProperty(exports, "accepted_response", { enumerable: true, get: function () { return response_1.accepted_response; } });
Object.defineProperty(exports, "USER_ERROR_MESSAGES", { enumerable: true, get: function () { return response_1.USER_ERROR_MESSAGES; } });
Object.defineProperty(exports, "get_user_message", { enumerable: true, get: function () { return response_1.get_user_message; } });
// Plaid types
var plaid_1 = require("./plaid");
Object.defineProperty(exports, "LINK_TOKEN_CACHE_TTL_HOURS", { enumerable: true, get: function () { return plaid_1.LINK_TOKEN_CACHE_TTL_HOURS; } });
Object.defineProperty(exports, "CREATE_LINK_TOKEN_BUDGET", { enumerable: true, get: function () { return plaid_1.CREATE_LINK_TOKEN_BUDGET; } });
Object.defineProperty(exports, "LINK_PLAID_ACCOUNT_BUDGET", { enumerable: true, get: function () { return plaid_1.LINK_PLAID_ACCOUNT_BUDGET; } });
Object.defineProperty(exports, "INITIAL_SYNC_BUDGET", { enumerable: true, get: function () { return plaid_1.INITIAL_SYNC_BUDGET; } });
Object.defineProperty(exports, "MAX_RELINK_ATTEMPTS_BEFORE_HELP", { enumerable: true, get: function () { return plaid_1.MAX_RELINK_ATTEMPTS_BEFORE_HELP; } });
Object.defineProperty(exports, "RELINK_ATTEMPT_WINDOW_HOURS", { enumerable: true, get: function () { return plaid_1.RELINK_ATTEMPT_WINDOW_HOURS; } });
Object.defineProperty(exports, "RELINK_ATTEMPT_RETENTION_DAYS", { enumerable: true, get: function () { return plaid_1.RELINK_ATTEMPT_RETENTION_DAYS; } });
Object.defineProperty(exports, "CREATE_UPDATE_LINK_TOKEN_BUDGET", { enumerable: true, get: function () { return plaid_1.CREATE_UPDATE_LINK_TOKEN_BUDGET; } });
Object.defineProperty(exports, "STATUSES_REQUIRING_REAUTH", { enumerable: true, get: function () { return plaid_1.STATUSES_REQUIRING_REAUTH; } });
Object.defineProperty(exports, "STATUS_ERROR_MESSAGES", { enumerable: true, get: function () { return plaid_1.STATUS_ERROR_MESSAGES; } });
// Budget CRUD types (5-layer architecture)
var budgets_1 = require("./budgets");
// Create budget
Object.defineProperty(exports, "create_budget_input_schema", { enumerable: true, get: function () { return budgets_1.create_budget_input_schema; } });
Object.defineProperty(exports, "MAX_BUDGETS_PER_USER", { enumerable: true, get: function () { return budgets_1.MAX_BUDGETS_PER_USER; } });
Object.defineProperty(exports, "CREATE_BUDGET_BUDGET", { enumerable: true, get: function () { return budgets_1.CREATE_BUDGET_BUDGET; } });
// Update budget
Object.defineProperty(exports, "update_budget_input_schema", { enumerable: true, get: function () { return budgets_1.update_budget_input_schema; } });
Object.defineProperty(exports, "EVERYTHING_ELSE_EDITABLE_FIELDS", { enumerable: true, get: function () { return budgets_1.EVERYTHING_ELSE_EDITABLE_FIELDS; } });
Object.defineProperty(exports, "UPDATE_BUDGET_BUDGET", { enumerable: true, get: function () { return budgets_1.UPDATE_BUDGET_BUDGET; } });
// Delete budget
Object.defineProperty(exports, "delete_budget_input_schema", { enumerable: true, get: function () { return budgets_1.delete_budget_input_schema; } });
Object.defineProperty(exports, "DELETE_BUDGET_BUDGET", { enumerable: true, get: function () { return budgets_1.DELETE_BUDGET_BUDGET; } });
//# sourceMappingURL=index.js.map