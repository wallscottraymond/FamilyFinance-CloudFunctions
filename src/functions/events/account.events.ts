/**
 * Account Events
 *
 * Helper functions for emitting account-related domain events.
 *
 * @module events/account
 */

import { TraceContext } from "../types";
import {
  emit_domain_event,
  ACCOUNT_EVENTS as EVENT_TYPES,
  AccountBalanceUpdatedPayload,
  AccountCreatedPayload,
  AccountRemovedPayload,
} from "./domain_events";

/**
 * Account event emission helpers.
 * Provides typed methods for emitting account events.
 */
export const ACCOUNT_EVENTS = {
  /**
   * Emits an account.balance_updated event.
   *
   * @param ctx - Trace context
   * @param payload - Balance update details
   */
  async emit_balance_updated(
    ctx: TraceContext,
    payload: AccountBalanceUpdatedPayload
  ): Promise<void> {
    emit_domain_event({
      type: EVENT_TYPES.BALANCE_UPDATED,
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
  async emit_created(
    ctx: TraceContext,
    payload: AccountCreatedPayload
  ): Promise<void> {
    emit_domain_event({
      type: EVENT_TYPES.CREATED,
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
  async emit_removed(
    ctx: TraceContext,
    payload: AccountRemovedPayload
  ): Promise<void> {
    emit_domain_event({
      type: EVENT_TYPES.REMOVED,
      payload,
      trace_id: ctx.trace_id,
      causation_id: ctx.span_id,
      user_id: payload.user_id,
    });
  },
};
