/**
 * Item Status Webhook Domain Service
 *
 * Pure business logic for processing item status webhooks.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/item_status_webhook
 */
import { ItemStatusUpdate } from "../../types/plaid/item_status_webhook.types";
/**
 * Whether an error code is a transient/rate-limit failure that should be
 * retried silently rather than surfaced to the user. PURE.
 */
export declare function is_transient_error_code(error_code: string): boolean;
/**
 * Computes the status update for a PENDING_EXPIRATION webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param consent_expiration_time - ISO timestamp when consent expires
 * @returns Status update to apply
 */
export declare function compute_pending_expiration_update(consent_expiration_time?: string): ItemStatusUpdate;
/**
 * Computes the status update for an ERROR webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The Plaid error code
 * @param error_message - The Plaid error message
 * @returns Status update to apply
 */
export declare function compute_error_update(error_code: string, error_message?: string): ItemStatusUpdate;
/**
 * Computes the status update for a LOGIN_REPAIRED webhook.
 * This clears the error state and sets status back to healthy.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
export declare function compute_login_repaired_update(): ItemStatusUpdate;
/**
 * Computes the status update that ESCALATES a transient error to the user after
 * it has persisted past the surface threshold. The connection has been failing
 * silently for too long, so we surface it as needing a reconnect (reusing the
 * existing reauth UI — update mode is the available user action).
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param original_error_code - The transient error code that persisted
 * @returns Status update to apply
 */
export declare function compute_escalation_update(original_error_code: string | null): ItemStatusUpdate;
/**
 * Computes the status update for a USER_PERMISSION_REVOKED webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
export declare function compute_permission_revoked_update(): ItemStatusUpdate;
/**
 * Determines if a status change should trigger a data refresh.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param previous_status - The previous item status
 * @param new_status - The new item status
 * @returns Whether to trigger a data refresh
 */
export declare function should_trigger_refresh(previous_status: string | null, new_status: string): boolean;
/**
 * Gets the webhook code that should mark a relink attempt as successful.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param webhook_code - The webhook code received
 * @returns Whether this webhook indicates a successful relink
 */
export declare function is_successful_relink_webhook(webhook_code: string): boolean;
//# sourceMappingURL=item_status_webhook.service.d.ts.map