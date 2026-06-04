"use strict";
/**
 * Account Events
 *
 * Helper functions for emitting account-related domain events.
 *
 * @module events/account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_EVENTS = void 0;
const domain_events_1 = require("./domain_events");
/**
 * Account event emission helpers.
 * Provides typed methods for emitting account events.
 */
exports.ACCOUNT_EVENTS = {
    /**
     * Emits an account.balance_updated event.
     *
     * @param ctx - Trace context
     * @param payload - Balance update details
     */
    async emit_balance_updated(ctx, payload) {
        (0, domain_events_1.emit_domain_event)({
            type: domain_events_1.ACCOUNT_EVENTS.BALANCE_UPDATED,
            payload,
            trace_id: ctx.trace_id,
            causation_id: ctx.span_id,
            user_id: payload.user_id,
        });
    },
    /**
     * Emits an account.created event.
     *
     * @param ctx - Trace context
     * @param payload - Account creation details
     */
    async emit_created(ctx, payload) {
        (0, domain_events_1.emit_domain_event)({
            type: domain_events_1.ACCOUNT_EVENTS.CREATED,
            payload,
            trace_id: ctx.trace_id,
            causation_id: ctx.span_id,
            user_id: payload.user_id,
        });
    },
    /**
     * Emits an account.removed event.
     *
     * @param ctx - Trace context
     * @param payload - Account removal details
     */
    async emit_removed(ctx, payload) {
        (0, domain_events_1.emit_domain_event)({
            type: domain_events_1.ACCOUNT_EVENTS.REMOVED,
            payload,
            trace_id: ctx.trace_id,
            causation_id: ctx.span_id,
            user_id: payload.user_id,
        });
    },
};
//# sourceMappingURL=account.events.js.map