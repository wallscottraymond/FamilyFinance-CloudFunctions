"use strict";
/**
 * Event Types for Domain Events
 *
 * These types define the structure of domain events.
 * Note: We use Firestore Triggers (not custom event bus) for reactivity,
 * but these types are still useful for logging and audit purposes.
 *
 * @module types/events
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_event = create_event;
exports.create_change_event = create_change_event;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Creates a domain event.
 */
function create_event(type, payload, trace_id, causation_id) {
    return {
        event_id: crypto.randomUUID(),
        type,
        payload,
        trace_id,
        causation_id,
        created_at: firestore_1.Timestamp.now(),
    };
}
/**
 * Creates an entity change event.
 */
function create_change_event(event_type, entity_type, entity_id, user_id, before, after, trace_id, causation_id) {
    const changed_fields = before && after
        ? detect_changed_fields(before, after)
        : undefined;
    return create_event(event_type, {
        entity_type,
        entity_id,
        user_id,
        before,
        after,
        changed_fields,
    }, trace_id, causation_id);
}
/**
 * Detects which fields changed between two object states.
 */
function detect_changed_fields(before, after) {
    const changed = [];
    const all_keys = new Set([
        ...Object.keys(before),
        ...Object.keys(after),
    ]);
    for (const key of all_keys) {
        const before_val = before[key];
        const after_val = after[key];
        if (JSON.stringify(before_val) !== JSON.stringify(after_val)) {
            changed.push(key);
        }
    }
    return changed;
}
//# sourceMappingURL=events.js.map