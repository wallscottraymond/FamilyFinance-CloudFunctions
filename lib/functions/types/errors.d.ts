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
export declare class DomainError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, details?: Record<string, unknown> | undefined);
    /**
     * Converts error to a serializable format for responses.
     */
    toJSON(): Record<string, unknown>;
}
/**
 * Thrown when business validation fails in domain services.
 * Contains an array of all validation errors.
 */
export declare class ValidationError extends DomainError {
    readonly errors: string[];
    constructor(errors: string[], details?: Record<string, unknown>);
}
/**
 * Thrown when a request with the same idempotency key is already processing.
 * Client should wait and retry, not resubmit.
 */
export declare class IdempotencyConflictError extends DomainError {
    constructor(idempotency_key: string);
}
/**
 * Thrown when performance budget is exceeded.
 * Orchestrator should switch to async processing.
 */
export declare class PerformanceBudgetExceededError extends DomainError {
    readonly budget: {
        max_reads: number;
        max_writes: number;
        max_time_ms: number;
    };
    readonly actual: {
        reads: number;
        writes: number;
        time_ms: number;
    };
    constructor(budget: {
        max_reads: number;
        max_writes: number;
        max_time_ms: number;
    }, actual: {
        reads: number;
        writes: number;
        time_ms: number;
    });
}
/**
 * Thrown when an entity is not found.
 */
export declare class NotFoundError extends DomainError {
    constructor(entity_type: string, entity_id: string);
}
/**
 * Thrown when user lacks permission for an operation.
 */
export declare class PermissionDeniedError extends DomainError {
    constructor(operation: string, resource?: string);
}
/**
 * Thrown when rate limit is exceeded.
 */
export declare class RateLimitExceededError extends DomainError {
    constructor(limit_type: "read" | "write", limit: number, window_seconds: number);
}
/**
 * Thrown when an external service (Plaid, etc.) is unavailable.
 * Circuit breaker is likely open.
 */
export declare class ExternalServiceError extends DomainError {
    readonly is_circuit_open: boolean;
    constructor(service_name: string, is_circuit_open?: boolean, original_error?: Error);
}
/**
 * Thrown when an operation times out.
 */
export declare class TimeoutError extends DomainError {
    constructor(operation: string, timeout_ms: number);
}
/**
 * Thrown when a Firestore trigger detects it has already processed this event.
 * This is NOT an error condition - just signals to stop processing.
 */
export declare class AlreadyProcessedError extends DomainError {
    constructor(idempotency_key: string);
}
/**
 * Maps DomainError to HTTP status codes for Entry layer.
 */
export declare function get_http_status(error: DomainError): number;
/**
 * Maps DomainError to Firebase HttpsError codes.
 */
export type HttpsErrorCode = "invalid-argument" | "not-found" | "permission-denied" | "aborted" | "resource-exhausted" | "deadline-exceeded" | "unavailable" | "internal" | "ok";
export declare function get_https_error_code(error: DomainError): HttpsErrorCode;
//# sourceMappingURL=errors.d.ts.map