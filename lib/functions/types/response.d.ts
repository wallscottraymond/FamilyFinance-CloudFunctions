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
export declare function success_response<T>(data: T, trace_id: string, options?: {
    processing_background?: boolean;
    version?: string;
}): FunctionResponse<T>;
/**
 * Creates an error response.
 */
export declare function error_response<T>(code: string, message: string, trace_id: string, options?: {
    version?: string;
}): FunctionResponse<T>;
/**
 * Creates a response indicating work was accepted for background processing.
 */
export declare function accepted_response<T>(partial_data: T | undefined, trace_id: string, options?: {
    version?: string;
}): FunctionResponse<T>;
/**
 * User-facing error messages by error code.
 * Entry layer uses these for consistent messaging.
 */
export declare const USER_ERROR_MESSAGES: Record<string, string>;
/**
 * Gets a user-friendly error message for an error code.
 */
export declare function get_user_message(code: string): string;
//# sourceMappingURL=response.d.ts.map