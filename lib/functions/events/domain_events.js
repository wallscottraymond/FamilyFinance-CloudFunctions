"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAID_EVENTS = exports.ACCOUNT_EVENTS = void 0;
exports.emit_domain_event = emit_domain_event;
exports.create_event_emitter = create_event_emitter;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../observability");
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
function emit_domain_event(event, options = {}) {
    const full_event = Object.assign(Object.assign({}, event), { event_id: (0, observability_1.generate_id)(), created_at: firestore_1.Timestamp.now() });
    // Always log asynchronously
    (0, observability_1.fire_and_forget)(async () => {
        (0, observability_1.log_async_debug)({
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
                await (0, firestore_1.getFirestore)()
                    .collection(EVENTS_COLLECTION)
                    .doc(full_event.event_id)
                    .set(full_event);
            }
            catch (error) {
                // Log but don't fail - events are fire-and-forget
                console.error("Failed to persist domain event:", error);
            }
        }
    });
}
function create_event_emitter(trace_id, causation_id, user_id) {
    return {
        emit(type, payload, options) {
            emit_domain_event({
                type,
                payload,
                trace_id,
                causation_id,
                user_id,
            }, options);
        },
    };
}
/**
 * Standard event types for accounts domain.
 */
exports.ACCOUNT_EVENTS = {
    CREATED: "account.created",
    UPDATED: "account.updated",
    REMOVED: "account.removed",
    RESTORED: "account.restored",
    BALANCE_UPDATED: "account.balance_updated",
    SYNC_COMPLETED: "account.sync_completed",
};
/**
 * Standard event types for Plaid domain.
 */
exports.PLAID_EVENTS = {
    ITEM_CREATED: "plaid.item_created",
    ITEM_UPDATED: "plaid.item_updated",
    ITEM_REMOVED: "plaid.item_removed",
    ITEM_ERROR: "plaid.item_error",
    SYNC_STARTED: "plaid.sync_started",
    SYNC_COMPLETED: "plaid.sync_completed",
};
//# sourceMappingURL=domain_events.js.map