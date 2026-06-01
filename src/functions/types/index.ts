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

// Context types
export {
  TraceContext,
  OrchestratorContext,
  PerformanceBudget,
  PerformanceMetrics,
  DEFAULT_PERFORMANCE_BUDGET,
  create_performance_metrics,
  update_elapsed_time,
  is_budget_exceeded,
} from "./context";

// Domain result types
export {
  DomainResult,
  success,
  success_many,
  validation_failed,
  partial_success,
  has_errors,
  has_entities,
  get_entities,
  combine_results,
} from "./domain";

// Repository types
export {
  WriteMode,
  WriteResult,
  BatchWriteResult,
  ReadOptions,
  BaseEntity,
  AccessMetadata,
  compute_hash,
  create_write_result,
  FIRESTORE_BATCH_LIMIT,
  chunk_for_batch,
} from "./repository";

// Dependency types
export {
  RecomputationScope,
  ConsistencyRisk,
  ResolveStrategy,
  DerivedNodeType,
  DependencyResult,
  ChangeModel,
  DependencyDefinition,
  no_dependencies,
  single_dependency,
  batch_dependencies,
  full_rebuild,
  merge_dependencies,
} from "./dependency";

// Event types
export {
  DomainEvent,
  EventType,
  TransactionEventType,
  BudgetEventType,
  AccountEventType,
  PlaidEventType,
  RecurringEventType,
  EntityChangePayload,
  create_event,
  create_change_event,
} from "./events";

// Error types
export {
  DomainError,
  ValidationError,
  IdempotencyConflictError,
  PerformanceBudgetExceededError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitExceededError,
  ExternalServiceError,
  TimeoutError,
  AlreadyProcessedError,
  get_http_status,
  get_https_error_code,
} from "./errors";

// Response types
export {
  FunctionResponse,
  success_response,
  error_response,
  accepted_response,
  USER_ERROR_MESSAGES,
  get_user_message,
} from "./response";

// Plaid types
export {
  // Link token types
  CreateLinkTokenInput,
  CreateLinkTokenResponse,
  LinkTokenDependencies,
  ResolveLinkTokenInput,
  LinkTokenValidationInput,
  PlaidCreateLinkTokenInput,
  LinkTokenEvent,
  LinkTokenEventInput,
  GetValidTokenOptions,
  CreateLinkTokenOrchestratorResult,
  LINK_TOKEN_CACHE_TTL_HOURS,
  CREATE_LINK_TOKEN_BUDGET,
  // Link plaid account types (full flow)
  LinkPlaidAccountInput,
  PlaidLinkAccountMetadata,
  ResolveLinkAccountInput,
  LinkAccountValidationInput,
  CreatePlaidItemInput,
  LinkPlaidAccountResponse,
  TokenExchangeResult,
  LinkAccountDependencies,
  PlaidItemStatus,
  PlaidItem,
  LinkPlaidAccountOrchestratorResult,
  LINK_PLAID_ACCOUNT_BUDGET,
  // Initial sync types
  InitialSyncInput,
  InitialSyncValidationInput,
  InitialSyncDependencies,
  SyncPhaseResult,
  InitialSyncOrchestratorResult,
  INITIAL_SYNC_BUDGET,
  // Update link token types (re-authentication flow)
  CreateUpdateLinkTokenInput,
  CreateUpdateLinkTokenResponse,
  ResolveUpdateLinkTokenInput,
  UpdateLinkTokenDependencies,
  UpdateLinkTokenValidationInput,
  UpdateLinkTokenValidationResult,
  RelinkAttempt,
  RelinkAttemptInput,
  CreateUpdateLinkTokenOrchestratorResult,
  MAX_RELINK_ATTEMPTS_BEFORE_HELP,
  RELINK_ATTEMPT_WINDOW_HOURS,
  RELINK_ATTEMPT_RETENTION_DAYS,
  CREATE_UPDATE_LINK_TOKEN_BUDGET,
  STATUSES_REQUIRING_REAUTH,
  STATUS_ERROR_MESSAGES,
} from "./plaid";

// Budget CRUD types (5-layer architecture)
export {
  // Entity types
  BudgetEntity,
  BudgetPeriodEntity,
  BudgetAccessControl,
  BudgetPeriodType,
  BudgetType,
  RolloverStrategy,
  // Create budget
  create_budget_input_schema,
  CreateBudgetInputData,
  CreateBudgetInput,
  CreateBudgetDependencies,
  CreateBudgetComputeInput,
  CreateBudgetResponse,
  CreateBudgetOrchestratorResult,
  MAX_BUDGETS_PER_USER,
  CREATE_BUDGET_BUDGET,
  // Update budget
  update_budget_input_schema,
  UpdateBudgetInputData,
  UpdateBudgetInput,
  UpdateBudgetDependencies,
  UpdateBudgetComputeInput,
  UpdateBudgetResponse,
  UpdateBudgetOrchestratorResult,
  EVERYTHING_ELSE_EDITABLE_FIELDS,
  UPDATE_BUDGET_BUDGET,
  // Delete budget
  delete_budget_input_schema,
  DeleteBudgetInputData,
  DeleteBudgetInput,
  DeleteBudgetDependencies,
  DeleteBudgetComputeInput,
  DeleteBudgetPlan,
  ProcessBudgetDeletedPayload,
  DeleteBudgetResponse,
  DeleteBudgetOrchestratorResult,
  DELETE_BUDGET_BUDGET,
} from "./budgets";
