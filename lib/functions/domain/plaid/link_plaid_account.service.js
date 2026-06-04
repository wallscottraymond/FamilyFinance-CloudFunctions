"use strict";
/**
 * Link Plaid Account Domain Service
 *
 * Pure business logic for linking Plaid accounts.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/link_plaid_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_link_account_request = validate_link_account_request;
exports.validate_plaid_item_for_creation = validate_plaid_item_for_creation;
exports.get_link_account_error_message = get_link_account_error_message;
/**
 * Validates a request to link a Plaid account.
 *
 * Business rules validated:
 * 1. User ID must be present
 * 2. Public token must be present
 * 3. Institution ID and name must be present
 *
 * Note: We allow re-linking the same institution (user may want to refresh connection).
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Validation input
 * @returns Domain result with validated input or validation errors
 */
function validate_link_account_request(input) {
    const validation_errors = [];
    // Rule 1: User ID is required
    if (!input.user_id) {
        validation_errors.push("User ID is required");
    }
    // Rule 2: Public token is required
    if (!input.public_token) {
        validation_errors.push("Public token is required");
    }
    // Rule 3: Institution ID is required
    if (!input.institution_id) {
        validation_errors.push("Institution ID is required");
    }
    // Rule 4: Institution name is required
    if (!input.institution_name) {
        validation_errors.push("Institution name is required");
    }
    // Return validation errors if any
    if (validation_errors.length > 0) {
        return { validation_errors };
    }
    // Passthrough - input is valid
    return { entity: input };
}
/**
 * Validates input for creating a Plaid item.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Create item input
 * @returns Domain result with validated input or validation errors
 */
function validate_plaid_item_for_creation(input) {
    const validation_errors = [];
    // Required fields
    if (!input.plaid_item_id) {
        validation_errors.push("Plaid item ID is required");
    }
    if (!input.user_id) {
        validation_errors.push("User ID is required");
    }
    if (!input.access_token) {
        validation_errors.push("Access token is required");
    }
    if (!input.institution_id) {
        validation_errors.push("Institution ID is required");
    }
    if (!input.institution_name) {
        validation_errors.push("Institution name is required");
    }
    // Access token format validation
    if (input.access_token && !input.access_token.startsWith("access-")) {
        validation_errors.push("Invalid access token format");
    }
    if (validation_errors.length > 0) {
        return { validation_errors };
    }
    return { entity: input };
}
/**
 * Gets a user-friendly error message for link account failures.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The error code from Plaid or internal
 * @returns User-friendly error message
 */
function get_link_account_error_message(error_code) {
    // We intentionally return a generic message per project decisions.
    // This avoids exposing Plaid internals to users.
    return "Unable to connect to bank. Please try again later.";
}
//# sourceMappingURL=link_plaid_account.service.js.map