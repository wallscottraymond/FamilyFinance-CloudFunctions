/**
 * Link Plaid Account Domain Service
 *
 * Pure business logic for linking Plaid accounts.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/link_plaid_account
 */
import { DomainResult } from "../../types";
import { LinkAccountValidationInput, CreatePlaidItemInput } from "../../types/plaid";
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
export declare function validate_link_account_request(input: LinkAccountValidationInput): DomainResult<LinkAccountValidationInput>;
/**
 * Validates input for creating a Plaid item.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Create item input
 * @returns Domain result with validated input or validation errors
 */
export declare function validate_plaid_item_for_creation(input: CreatePlaidItemInput): DomainResult<CreatePlaidItemInput>;
/**
 * Gets a user-friendly error message for link account failures.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The error code from Plaid or internal
 * @returns User-friendly error message
 */
export declare function get_link_account_error_message(error_code: string): string;
//# sourceMappingURL=link_plaid_account.service.d.ts.map