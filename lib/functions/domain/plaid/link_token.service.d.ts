/**
 * Link Token Domain Service
 *
 * Pure business logic for link token validation.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/link_token
 */
import { DomainResult } from "../../types";
import { LinkTokenValidationInput } from "../../types/plaid";
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
export declare function validate_link_token_request(input: LinkTokenValidationInput): DomainResult<LinkTokenValidationInput>;
/**
 * Checks if the provided input represents an update mode request.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param access_token - Optional access token from input
 * @returns Whether this is an update mode request
 */
export declare function is_update_mode_request(access_token?: string): boolean;
/**
 * Gets a user-friendly error message for link token failures.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The error code from Plaid or internal
 * @returns User-friendly error message
 */
export declare function get_link_token_error_message(error_code: string): string;
//# sourceMappingURL=link_token.service.d.ts.map