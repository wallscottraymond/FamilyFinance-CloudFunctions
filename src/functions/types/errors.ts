/**
 * Error Types for the Layered Architecture
 *
 * All errors extend DomainError for consistent handling.
 * Entry layer converts these to appropriate HTTP responses.
 *
 * @module types/errors
 */

/**
 * Base error class for all domain errors.
 * Provides consistent structure for error handling.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DomainError";
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Converts error to a serializable format for responses.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * Thrown when business validation fails in domain services.
 * Contains an array of all validation errors.
 */
export class ValidationError extends DomainError {
  constructor(
    public readonly errors: string[],
    details?: Record<string, unknown>
  ) {
    super(errors.join("; "), "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when a request with the same idempotency key is already processing.
 * Client should wait and retry, not resubmit.
 */
export class IdempotencyConflictError extends DomainError {
  constructor(idempotency_key: string) {
    super(
      "This action is already in progress. Please wait.",
      "IDEMPOTENCY_CONFLICT",
      { idempotency_key }
    );
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Thrown when performance budget is exceeded.
 * Orchestrator should switch to async processing.
 */
export class PerformanceBudgetExceededError extends DomainError {
  constructor(
    public readonly budget: {
      max_reads: number;
      max_writes: number;
      max_time_ms: number;
    },
    public readonly actual: {
      reads: number;
      writes: number;
      time_ms: number;
    }
  ) {
    super(
      "Performance budget exceeded: " +
      `reads=${actual.reads}/${budget.max_reads}, ` +
      `writes=${actual.writes}/${budget.max_writes}, ` +
      `time=${actual.time_ms}/${budget.max_time_ms}`,
      "PERFORMANCE_BUDGET_EXCEEDED",
      { budget, actual }
    );
    this.name = "PerformanceBudgetExceededError";
  }
}

/**
 * Thrown when an entity is not found.
 */
export class NotFoundError extends DomainError {
  constructor(entity_type: string, entity_id: string) {
    super(
      `${entity_type} with id ${entity_id} not found`,
      "NOT_FOUND",
      { entity_type, entity_id }
    );
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when user lacks permission for an operation.
 */
export class PermissionDeniedError extends DomainError {
  constructor(operation: string, resource?: string) {
    super(
      `Permission denied for ${operation}${resource ? ` on ${resource}` : ""}`,
      "PERMISSION_DENIED",
      { operation, resource }
    );
    this.name = "PermissionDeniedError";
  }
}

/**
 * Thrown when rate limit is exceeded.
 */
export class RateLimitExceededError extends DomainError {
  constructor(
    limit_type: "read" | "write",
    limit: number,
    window_seconds: number
  ) {
    super(
      "Too many requests. Please slow down.",
      "RATE_LIMIT_EXCEEDED",
      { limit_type, limit, window_seconds }
    );
    this.name = "RateLimitExceededError";
  }
}

/**
 * Thrown when an external service (Plaid, etc.) is unavailable.
 * Circuit breaker is likely open.
 */
export class ExternalServiceError extends DomainError {
  constructor(
    service_name: string,
    public readonly is_circuit_open: boolean = false,
    original_error?: Error
  ) {
    super(
      is_circuit_open
        ? `${service_name} is temporarily unavailable. Please try again later.`
        : `Error communicating with ${service_name}`,
      "EXTERNAL_SERVICE_ERROR",
      {
        service_name,
        is_circuit_open,
        original_message: original_error?.message,
      }
    );
    this.name = "ExternalServiceError";
  }
}

/**
 * Thrown when an operation times out.
 */
export class TimeoutError extends DomainError {
  constructor(operation: string, timeout_ms: number) {
    super(
      `Operation ${operation} timed out after ${timeout_ms}ms`,
      "TIMEOUT",
      { operation, timeout_ms }
    );
    this.name = "TimeoutError";
  }
}

/**
 * Thrown when a Firestore trigger detects it has already processed this event.
 * This is NOT an error condition - just signals to stop processing.
 */
export class AlreadyProcessedError extends DomainError {
  constructor(idempotency_key: string) {
    super(
      `Event already processed: ${idempotency_key}`,
      "ALREADY_PROCESSED",
      { idempotency_key }
    );
    this.name = "AlreadyProcessedError";
  }
}

/**
 * Maps DomainError to HTTP status codes for Entry layer.
 */
export function get_http_status(error: DomainError): number {
  switch (error.code) {
  case "VALIDATION_ERROR":
    return 400; // Bad Request
  case "NOT_FOUND":
    return 404; // Not Found
  case "PERMISSION_DENIED":
    return 403; // Forbidden
  case "IDEMPOTENCY_CONFLICT":
    return 409; // Conflict
  case "RATE_LIMIT_EXCEEDED":
    return 429; // Too Many Requests
  case "TIMEOUT":
    return 504; // Gateway Timeout
  case "EXTERNAL_SERVICE_ERROR":
    return 502; // Bad Gateway
  case "PERFORMANCE_BUDGET_EXCEEDED":
    return 202; // Accepted (will process async)
  case "ALREADY_PROCESSED":
    return 200; // OK (idempotent success)
  default:
    return 500; // Internal Server Error
  }
}

/**
 * Maps DomainError to Firebase HttpsError codes.
 */
export type HttpsErrorCode =
  | "invalid-argument"
  | "not-found"
  | "permission-denied"
  | "aborted"
  | "resource-exhausted"
  | "deadline-exceeded"
  | "unavailable"
  | "internal"
  | "ok";

export function get_https_error_code(error: DomainError): HttpsErrorCode {
  switch (error.code) {
  case "VALIDATION_ERROR":
    return "invalid-argument";
  case "NOT_FOUND":
    return "not-found";
  case "PERMISSION_DENIED":
    return "permission-denied";
  case "IDEMPOTENCY_CONFLICT":
    return "aborted";
  case "RATE_LIMIT_EXCEEDED":
    return "resource-exhausted";
  case "TIMEOUT":
    return "deadline-exceeded";
  case "EXTERNAL_SERVICE_ERROR":
    return "unavailable";
  case "ALREADY_PROCESSED":
    return "ok";
  default:
    return "internal";
  }
}
