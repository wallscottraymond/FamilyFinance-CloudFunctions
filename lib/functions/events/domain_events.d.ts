/**
 * Domain Events
 *
 * Lightweight event emission for domain events.
 * Events are logged for observability and can trigger Firestore triggers.
 *
 * Note: Per architecture guide, we use Firestore triggers for reactions,
 * not a custom event bus. This module provides the emission side.
 *
 * @module events/domain_events
 */
import { Timestamp } from "firebase-admin/firestore";
/**
 * Domain event structure.
 */
export interface DomainEvent<T = unknown> {
    /** Unique event ID */
    event_id: string;
    /** Event type (e.g., "account.removed", "transaction.created") */
    type: string;
    /** Event payload */
    payload: T;
    /** Trace ID for correlation */
    trace_id: string;
    /** Span that caused this event */
    causation_id: string;
    /** When the event occurred */
    created_at: Timestamp;
    /** User who triggered the event (if applicable) */
    user_id?: string;
}
/**
 * Options for emitting events.
 */
interface EmitOptions {
    /** Whether to persist to Firestore (default: true in production) */
    persist?: boolean;
}
/**
 * Emits a domain event.
 *
 * Events are:
 * 1. Logged asynchronously for observability
 * 2. Optionally persisted to Firestore for audit trail
 *
 * This is fire-and-forget - failures don't affect the main operation.
 *
 * @param event - The domain event to emit
 * @param options - Emission options
 */
export declare function emit_domain_event<T>(event: Omit<DomainEvent<T>, "event_id" | "created_at">, options?: EmitOptions): void;
/**
 * Creates an event emitter bound to a trace context.
 * Convenience function for orchestrators.
 *
 * @param trace_id - The trace ID
 * @param causation_id - The span ID that will cause events
 * @param user_id - Optional user ID
 */
interface EventEmitter {
    emit<T>(type: string, payload: T, options?: EmitOptions): void;
}
export declare function create_event_emitter(trace_id: string, causation_id: string, user_id?: string): EventEmitter;
/**
 * Standard event types for accounts domain.
 */
export declare const ACCOUNT_EVENTS: {
    readonly CREATED: "account.created";
    readonly UPDATED: "account.updated";
    readonly REMOVED: "account.removed";
    readonly RESTORED: "account.restored";
    readonly BALANCE_UPDATED: "account.balance_updated";
    readonly SYNC_COMPLETED: "account.sync_completed";
};
/**
 * Payload types for account events.
 */
export interface AccountRemovedPayload {
    account_id: string;
    user_id: string;
    removed_at: Timestamp;
}
export interface AccountCreatedPayload {
    account_id: string;
    user_id: string;
    item_id: string;
    institution_id: string;
    institution_name: string;
    account_type: string;
    created_at: Timestamp;
}
export interface AccountBalanceUpdatedPayload {
    account_id: string;
    user_id: string;
    previous_balance: number;
    new_balance: number;
}
export interface AccountRestoredPayload {
    account_id: string;
    user_id: string;
    restored_at: Timestamp;
    restore_transactions: boolean;
    restore_recurring: boolean;
}
/**
 * Standard event types for Plaid domain.
 */
export declare const PLAID_EVENTS: {
    readonly ITEM_CREATED: "plaid.item_created";
    readonly ITEM_UPDATED: "plaid.item_updated";
    readonly ITEM_REMOVED: "plaid.item_removed";
    readonly ITEM_ERROR: "plaid.item_error";
    readonly SYNC_STARTED: "plaid.sync_started";
    readonly SYNC_COMPLETED: "plaid.sync_completed";
};
/**
 * Payload types for Plaid events.
 */
export interface PlaidItemCreatedPayload {
    item_id: string;
    user_id: string;
    institution_id: string;
    institution_name: string;
    created_at: Timestamp;
}
export interface PlaidItemRemovedPayload {
    item_id: string;
    user_id: string;
    removed_at: Timestamp;
}
export interface PlaidItemErrorPayload {
    item_id: string;
    user_id: string;
    error_code: string;
    error_message: string;
}
export {};
//# sourceMappingURL=domain_events.d.ts.map