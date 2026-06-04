"use strict";
/**
 * Response Types for API Responses
 *
 * All API responses follow this standard format.
 * Entry layer constructs these responses.
 *
 * @module types/response
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_ERROR_MESSAGES = void 0;
exports.success_response = success_response;
exports.error_response = error_response;
exports.accepted_response = accepted_response;
exports.get_user_message = get_user_message;
/**
 * Creates a successful response.
 */
function success_response(data, trace_id, options) {
    return {
        success: true,
        data,
        trace_id,
        processing_background: options === null || options === void 0 ? void 0 : options.processing_background,
        api_version: options === null || options === void 0 ? void 0 : options.version,
    };
}
/**
 * Creates an error response.
 */
function error_response(code, message, trace_id, options) {
    return {
        success: false,
        trace_id,
        error: { code, message },
        api_version: options === null || options === void 0 ? void 0 : options.version,
    };
}
/**
 * Creates a response indicating work was accepted for background processing.
 */
function accepted_response(partial_data, trace_id, options) {
    return {
        success: true,
        data: partial_data,
        trace_id,
        processing_background: true,
        api_version: options === null || options === void 0 ? void 0 : options.version,
    };
}
/**
 * User-facing error messages by error code.
 * Entry layer uses these for consistent messaging.
 */
exports.USER_ERROR_MESSAGES = {
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
function get_user_message(code) {
    var _a;
    return (_a = exports.USER_ERROR_MESSAGES[code]) !== null && _a !== void 0 ? _a : exports.USER_ERROR_MESSAGES.INTERNAL;
}
//# sourceMappingURL=response.js.map