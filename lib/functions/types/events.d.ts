/**
 * Event Types for Domain Events
 *
 * These types define the structure of domain events.
 * Note: We use Firestore Triggers (not custom event bus) for reactivity,
 * but these types are still useful for logging and audit purposes.
 *
 * @module types/events
 */
import { Timestamp } from "firebase-admin/firestore";
/**
 * Base structure for all domain events.
 * Used for audit logging and observability.
 */
export interface DomainEvent<T = unknown> {
    /** Unique identifier for this event (UUID) */
    event_id: string;
    /** Type of event (e.g., "transaction.created", "budget.updated") */
    type: string;
    /** Event payload (the data that changed) */
    payload: T;
    /** Trace ID linking this event to the originating request */
    trace_id: string;
    /** ID of the span/event that caused this event */
    causation_id: string;
    /** When the event was created */
    created_at: Timestamp;
}
/**
 * Event types for transactions.
 */
export type TransactionEventType = "transaction.created" | "transaction.updated" | "transaction.deleted" | "transaction.approved" | "transaction.rejected";
/**
 * Event types for budgets.
 */
export type BudgetEventType = "budget.created" | "budget.updated" | "budget.deleted" | "budget.period_extended" | "budget.rollover_calculated";
/**
 * Event types for accounts.
 */
export type AccountEventType = "account.created" | "account.updated" | "account.deleted" | "account.balance_updated" | "account.linked" | "account.unlinked";
/**
 * Event types for Plaid integration.
 */
export type PlaidEventType = "plaid.item_created" | "plaid.item_removed" | "plaid.transactions_synced" | "plaid.balances_synced" | "plaid.webhook_received";
/**
 * Event types for recurring items.
 */
export type RecurringEventType = "outflow.created" | "outflow.updated" | "outflow.deleted" | "outflow.period_paid" | "inflow.created" | "inflow.updated" | "inflow.deleted" | "inflow.period_received";
/**
 * All event types combined.
 */
export type EventType = TransactionEventType | BudgetEventType | AccountEventType | PlaidEventType | RecurringEventType;
/**
 * Payload for entity change events.
 */
export interface EntityChangePayload<T> {
    /** Entity type (e.g., "transaction", "budget") */
    entity_type: string;
    /** Entity ID */
    entity_id: string;
    /** User who made the change */
    user_id: string;
    /** State before the change (null for creates) */
    before: T | null;
    /** State after the change (null for deletes) */
    after: T | null;
    /** Fields that changed (for updates) */
    changed_fields?: string[];
}
/**
 * Creates a domain event.
 */
export declare function create_event<T>(type: EventType, payload: T, trace_id: string, causation_id: string): DomainEvent<T>;
/**
 * Creates an entity change event.
 */
export declare function create_change_event<T>(event_type: EventType, entity_type: string, entity_id: string, user_id: string, before: T | null, after: T | null, trace_id: string, causation_id: string): DomainEvent<EntityChangePayload<T>>;
//# sourceMappingURL=events.d.ts.map