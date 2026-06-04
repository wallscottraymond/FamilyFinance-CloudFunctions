"use strict";
/**
 * Error Types for the Layered Architecture
 *
 * All errors extend DomainError for consistent handling.
 * Entry layer converts these to appropriate HTTP responses.
 *
 * @module types/errors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlreadyProcessedError = exports.TimeoutError = exports.ExternalServiceError = exports.RateLimitExceededError = exports.PermissionDeniedError = exports.NotFoundError = exports.PerformanceBudgetExceededError = exports.IdempotencyConflictError = exports.ValidationError = exports.DomainError = void 0;
exports.get_http_status = get_http_status;
exports.get_https_error_code = get_https_error_code;
/**
 * Base error class for all domain errors.
 * Provides consistent structure for error handling.
 */
class DomainError extends Error {
    constructor(message, code, details) {
        var _a;
        super(message);
        this.code = code;
        this.details = details;
        this.name = "DomainError";
        // Maintains proper stack trace for where error was thrown
        (_a = Error.captureStackTrace) === null || _a === void 0 ? void 0 : _a.call(Error, this, this.constructor);
    }
    /**
     * Converts error to a serializable format for responses.
     */
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
        };
    }
}
exports.DomainError = DomainError;
/**
 * Thrown when business validation fails in domain services.
 * Contains an array of all validation errors.
 */
class ValidationError extends DomainError {
    constructor(errors, details) {
        super(errors.join("; "), "VALIDATION_ERROR", details);
        this.errors = errors;
        this.name = "ValidationError";
    }
}
exports.ValidationError = ValidationError;
/**
 * Thrown when a request with the same idempotency key is already processing.
 * Client should wait and retry, not resubmit.
 */
class IdempotencyConflictError extends DomainError {
    constructor(idempotency_key) {
        super("This action is already in progress. Please wait.", "IDEMPOTENCY_CONFLICT", { idempotency_key });
        this.name = "IdempotencyConflictError";
    }
}
exports.IdempotencyConflictError = IdempotencyConflictError;
/**
 * Thrown when performance budget is exceeded.
 * Orchestrator should switch to async processing.
 */
class PerformanceBudgetExceededError extends DomainError {
    constructor(budget, actual) {
        super("Performance budget exceeded: " +
            `reads=${actual.reads}/${budget.max_reads}, ` +
            `writes=${actual.writes}/${budget.max_writes}, ` +
            `time=${actual.time_ms}/${budget.max_time_ms}`, "PERFORMANCE_BUDGET_EXCEEDED", { budget, actual });
        this.budget = budget;
        this.actual = actual;
        this.name = "PerformanceBudgetExceededError";
    }
}
exports.PerformanceBudgetExceededError = PerformanceBudgetExceededError;
/**
 * Thrown when an entity is not found.
 */
class NotFoundError extends DomainError {
    constructor(entity_type, entity_id) {
        super(`${entity_type} with id ${entity_id} not found`, "NOT_FOUND", { entity_type, entity_id });
        this.name = "NotFoundError";
    }
}
exports.NotFoundError = NotFoundError;
/**
 * Thrown when user lacks permission for an operation.
 */
class PermissionDeniedError extends DomainError {
    constructor(operation, resource) {
        super(`Permission denied for ${operation}${resource ? ` on ${resource}` : ""}`, "PERMISSION_DENIED", { operation, resource });
        this.name = "PermissionDeniedError";
    }
}
exports.PermissionDeniedError = PermissionDeniedError;
/**
 * Thrown when rate limit is exceeded.
 */
class RateLimitExceededError extends DomainError {
    constructor(limit_type, limit, window_seconds) {
        super("Too many requests. Please slow down.", "RATE_LIMIT_EXCEEDED", { limit_type, limit, window_seconds });
        this.name = "RateLimitExceededError";
    }
}
exports.RateLimitExceededError = RateLimitExceededError;
/**
 * Thrown when an external service (Plaid, etc.) is unavailable.
 * Circuit breaker is likely open.
 */
class ExternalServiceError extends DomainError {
    constructor(service_name, is_circuit_open = false, original_error) {
        super(is_circuit_open
            ? `${service_name} is temporarily unavailable. Please try again later.`
            : `Error communicating with ${service_name}`, "EXTERNAL_SERVICE_ERROR", {
            service_name,
            is_circuit_open,
            original_message: original_error === null || original_error === void 0 ? void 0 : original_error.message,
        });
        this.is_circuit_open = is_circuit_open;
        this.name = "ExternalServiceError";
    }
}
exports.ExternalServiceError = ExternalServiceError;
/**
 * Thrown when an operation times out.
 */
class TimeoutError extends DomainError {
    constructor(operation, timeout_ms) {
        super(`Operation ${operation} timed out after ${timeout_ms}ms`, "TIMEOUT", { operation, timeout_ms });
        this.name = "TimeoutError";
    }
}
exports.TimeoutError = TimeoutError;
/**
 * Thrown when a Firestore trigger detects it has already processed this event.
 * This is NOT an error condition - just signals to stop processing.
 */
class AlreadyProcessedError extends DomainError {
    constructor(idempotency_key) {
        super(`Event already processed: ${idempotency_key}`, "ALREADY_PROCESSED", { idempotency_key });
        this.name = "AlreadyProcessedError";
    }
}
exports.AlreadyProcessedError = AlreadyProcessedError;
/**
 * Maps DomainError to HTTP status codes for Entry layer.
 */
function get_http_status(error) {
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
function get_https_error_code(error) {
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
//# sourceMappingURL=errors.js.map