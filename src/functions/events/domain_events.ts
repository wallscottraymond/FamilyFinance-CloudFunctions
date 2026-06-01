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

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { generate_id, fire_and_forget, log_async_debug } from "../observability";

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
 * Collection for domain events (for audit/replay).
 */
const EVENTS_COLLECTION = "_domain_events";

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
export function emit_domain_event<T>(
  event: Omit<DomainEvent<T>, "event_id" | "created_at">,
  options: EmitOptions = {}
): void {
  const full_event: DomainEvent<T> = {
    ...event,
    event_id: generate_id(),
    created_at: Timestamp.now(),
  };

  // Always log asynchronously
  fire_and_forget(async () => {
    log_async_debug({
      trace_id: full_event.trace_id,
      span_id: full_event.causation_id,
      layer: "events",
      function: "emit_domain_event",
      status: "emitted",
      context: {
        event_type: full_event.type,
        event_id: full_event.event_id,
      },
    });

    // Optionally persist to Firestore
    if (options.persist !== false) {
      try {
        await getFirestore()
          .collection(EVENTS_COLLECTION)
          .doc(full_event.event_id)
          .set(full_event);
      } catch (error) {
        // Log but don't fail - events are fire-and-forget
        console.error("Failed to persist domain event:", error);
      }
    }
  });
}

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

export function create_event_emitter(
  trace_id: string,
  causation_id: string,
  user_id?: string
): EventEmitter {
  return {
    emit<T>(type: string, payload: T, options?: EmitOptions): void {
      emit_domain_event(
        {
          type,
          payload,
          trace_id,
          causation_id,
          user_id,
        },
        options
      );
    },
  };
}

/**
 * Standard event types for accounts domain.
 */
export const ACCOUNT_EVENTS = {
  CREATED: "account.created",
  UPDATED: "account.updated",
  REMOVED: "account.removed",
  RESTORED: "account.restored",
  BALANCE_UPDATED: "account.balance_updated",
  SYNC_COMPLETED: "account.sync_completed",
} as const;

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
export const PLAID_EVENTS = {
  ITEM_CREATED: "plaid.item_created",
  ITEM_UPDATED: "plaid.item_updated",
  ITEM_REMOVED: "plaid.item_removed",
  ITEM_ERROR: "plaid.item_error",
  SYNC_STARTED: "plaid.sync_started",
  SYNC_COMPLETED: "plaid.sync_completed",
} as const;

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
