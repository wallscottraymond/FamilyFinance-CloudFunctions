"use strict";
/**
 * Link Token Domain Service
 *
 * Pure business logic for link token validation.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_link_token_request = validate_link_token_request;
exports.is_update_mode_request = is_update_mode_request;
exports.get_link_token_error_message = get_link_token_error_message;
/**
 * Validates a request to create a link token.
 *
 * Business rules validated:
 * 1. User ID must be present
 * 2. Update mode requires valid access token ownership
 * 3. Account limits (placeholder - not enforced yet)
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Validation input from resolver
 * @returns Domain result with validated input or validation errors
 */
function validate_link_token_request(input) {
    const validation_errors = [];
    // Rule 1: User ID is required
    if (!input.user_id) {
        validation_errors.push("User ID is required");
    }
    // Rule 2: Update mode requires valid access token
    if (input.is_update_mode && input.access_token_valid === false) {
        validation_errors.push("Invalid access token for update mode");
    }
    // Rule 3: Account limit (placeholder - not enforced)
    // This is intentionally commented out per project decisions.
    // The data is gathered by the resolver for future use.
    //
    // const MAX_PLAID_ITEMS = 10;
    // if (input.existing_item_count >= MAX_PLAID_ITEMS) {
    //   validation_errors.push(
    //     `Maximum ${MAX_PLAID_ITEMS} connected accounts allowed`
    //   );
    // }
    // Return validation errors if any
    if (validation_errors.length > 0) {
        return { validation_errors };
    }
    // Passthrough - input is valid
    return { entity: input };
}
/**
 * Checks if the provided input represents an update mode request.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param access_token - Optional access token from input
 * @returns Whether this is an update mode request
 */
function is_update_mode_request(access_token) {
    return access_token !== undefined && access_token.length > 0;
}
/**
 * Gets a user-friendly error message for link token failures.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The error code from Plaid or internal
 * @returns User-friendly error message
 */
function get_link_token_error_message(error_code) {
    // We intentionally return a generic message per project decisions.
    // This avoids exposing Plaid internals to users.
    return "Unable to connect to bank. Please try again later.";
}
//# sourceMappingURL=link_token.service.js.map