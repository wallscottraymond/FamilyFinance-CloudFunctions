/**
 * Link Token Event Repository
 *
 * Handles persistence for link token creation events.
 * Used for audit logging and token caching.
 *
 * @module repositories/plaid/link_token_event
 */
import { TraceContext, LinkTokenEvent, LinkTokenEventInput, GetValidTokenOptions } from "../../types";
/**
 * Link Token Event Repository
 *
 * Provides methods for:
 * - Logging link token creation events (audit trail)
 * - Retrieving valid cached tokens (caching)
 */
export declare const link_token_event_repo: {
    /**
     * Logs a link token creation event.
     *
     * Used for:
     * - Audit trail (who created tokens, when)
     * - Token caching (store token for later retrieval)
     *
     * @param event - Event data to log
     * @returns Promise that resolves when the event is logged
     */
    log_creation(event: LinkTokenEventInput): Promise<void>;
    /**
     * Retrieves a valid cached token for a user.
     *
     * A token is considered valid if:
     * - It belongs to the specified user
     * - It matches the update mode
     * - It was created within the max_age_hours
     *
     * @param ctx - Trace context for logging
     * @param user_id - User to get cached token for
     * @param is_update_mode - Whether to get update mode or normal mode token
     * @param options - Cache TTL options
     * @returns The cached event if found, null otherwise
     */
    get_valid_token(ctx: TraceContext, user_id: string, is_update_mode: boolean, options: GetValidTokenOptions): Promise<LinkTokenEvent | null>;
    /**
     * Gets all link token events for a user (for debugging/admin).
     *
     * @param ctx - Trace context for logging
     * @param user_id - User to get events for
     * @param limit - Maximum number of events to return
     * @returns Array of link token events
     */
    get_by_user_id(ctx: TraceContext, user_id: string, limit?: number): Promise<LinkTokenEvent[]>;
};
//# sourceMappingURL=link_token_event.repo.d.ts.map