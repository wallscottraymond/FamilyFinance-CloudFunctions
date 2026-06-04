/**
 * Update Link Token Domain Service
 *
 * Pure business logic for update link token validation.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/update_link_token
 */
import { UpdateLinkTokenValidationInput, UpdateLinkTokenValidationResult } from "../../types/plaid/update_link_token.types";
import { PlaidItemStatus } from "../../types/plaid";
/**
 * Validates a request to create an update link token.
 *
 * Business rules validated:
 * 1. Item must exist
 * 2. User must own the item
 * 3. Item must be active
 * 4. Access token must be valid (decrypted successfully)
 * 5. Item status must allow re-link (not already healthy, not permanently broken)
 * 6. Checks for excessive re-link attempts
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Validation input from resolver
 * @returns Validation result with errors or success
 */
export declare function validate_update_link_token_request(input: UpdateLinkTokenValidationInput): UpdateLinkTokenValidationResult;
/**
 * Checks if an item's status allows re-link.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param status - Current item status
 * @returns Whether re-link is allowed and reason if not
 */
export declare function check_item_status_for_relink(status: PlaidItemStatus | null): {
    relink_disabled: boolean;
    disabled_reason: string | null;
};
/**
 * Determines if user should see a help message based on failed attempts.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param recent_attempts - Number of recent re-link attempts
 * @returns Whether to show help message and what message
 */
export declare function should_show_help_message(recent_attempts: number): {
    show_help: boolean;
    message: string | null;
};
/**
 * Gets a user-friendly error message for update link token failures.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The error code from Plaid or internal
 * @returns User-friendly error message
 */
export declare function get_update_link_token_error_message(error_code: string): string;
//# sourceMappingURL=update_link_token.service.d.ts.map