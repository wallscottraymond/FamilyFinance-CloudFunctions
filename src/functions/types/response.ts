/**
 * Response Types for API Responses
 *
 * All API responses follow this standard format.
 * Entry layer constructs these responses.
 *
 * @module types/response
 */

/**
 * Standard response format for all API endpoints.
 * Every response includes trace_id for debugging.
 */
export interface FunctionResponse<T> {
  /** Whether the operation succeeded */
  success: boolean;

  /** The response data (present on success) */
  data?: T;

  /** Trace ID for debugging - ALWAYS included */
  trace_id: string;

  /** True when some work was deferred to background processing */
  processing_background?: boolean;

  /** Error information (present on failure) */
  error?: {
    /** Error code for programmatic handling */
    code: string;
    /** Human-readable error message */
    message: string;
  };

  /** API version that served this request (for canary tracking) */
  api_version?: string;
}

/**
 * Creates a successful response.
 */
export function success_response<T>(
  data: T,
  trace_id: string,
  options?: {
    processing_background?: boolean;
    version?: string;
  }
): FunctionResponse<T> {
  return {
    success: true,
    data,
    trace_id,
    processing_background: options?.processing_background,
    api_version: options?.version,
  };
}

/**
 * Creates an error response.
 */
export function error_response<T>(
  code: string,
  message: string,
  trace_id: string,
  options?: {
    version?: string;
  }
): FunctionResponse<T> {
  return {
    success: false,
    trace_id,
    error: { code, message },
    api_version: options?.version,
  };
}

/**
 * Creates a response indicating work was accepted for background processing.
 */
export function accepted_response<T>(
  partial_data: T | undefined,
  trace_id: string,
  options?: {
    version?: string;
  }
): FunctionResponse<T> {
  return {
    success: true,
    data: partial_data,
    trace_id,
    processing_background: true,
    api_version: options?.version,
  };
}

/**
 * User-facing error messages by error code.
 * Entry layer uses these for consistent messaging.
 */
export const USER_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "Please check your input and try again.",
  NOT_FOUND: "The requested item could not be found.",
  PERMISSION_DENIED: "You don't have permission to do this.",
  IDEMPOTENCY_CONFLICT: "This action is already in progress. Please wait.",
  RATE_LIMIT_EXCEEDED: "Too many requests. Please slow down.",
  TIMEOUT: "The operation took too long. Please try again.",
  EXTERNAL_SERVICE_ERROR: "A service is temporarily unavailable. Please try again later.",
  INTERNAL: "Something went wrong. Please try again.",
};

/**
 * Gets a user-friendly error message for an error code.
 */
export function get_user_message(code: string): string {
  return USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.INTERNAL;
}
