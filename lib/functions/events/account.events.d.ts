/**
 * Account Events
 *
 * Helper functions for emitting account-related domain events.
 *
 * @module events/account
 */
import { TraceContext } from "../types";
import { AccountBalanceUpdatedPayload, AccountCreatedPayload, AccountRemovedPayload } from "./domain_events";
/**
 * Account event emission helpers.
 * Provides typed methods for emitting account events.
 */
export declare const ACCOUNT_EVENTS: {
    /**
     * Emits an account.balance_updated event.
     *
     * @param ctx - Trace context
     * @param payload - Balance update details
     */
    emit_balance_updated(ctx: TraceContext, payload: AccountBalanceUpdatedPayload): Promise<void>;
    /**
     * Emits an account.created event.
     *
     * @param ctx - Trace context
     * @param payload - Account creation details
     */
    emit_created(ctx: TraceContext, payload: AccountCreatedPayload): Promise<void>;
    /**
     * Emits an account.removed event.
     *
     * @param ctx - Trace context
     * @param payload - Account removal details
     */
    emit_removed(ctx: TraceContext, payload: AccountRemovedPayload): Promise<void>;
};
//# sourceMappingURL=account.events.d.ts.map