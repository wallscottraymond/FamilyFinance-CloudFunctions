/**
 * Transient Error Retry Domain Service
 *
 * Pure decision logic for the auto-retry job: given how long an item has been
 * in a transient error state and whether a fresh sync probe succeeded, decide
 * whether the connection recovered, should keep being retried silently, or has
 * persisted long enough that it must be surfaced to the user.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/transient_error_retry
 */

import {
  RetryAction,
  RetryDecisionInput,
} from "../../types/plaid/transient_error_retry.types";

/**
 * Decide what to do with a transient item after a retry probe.
 *
 * - sync succeeded            → "recovered"
 * - sync failed, < threshold  → "keep_waiting" (stay silent)
 * - sync failed, ≥ threshold  → "escalate" (surface to user)
 *
 * If the transient-start time is unknown, the item is treated as just-started
 * (keep_waiting) so the surface clock can begin on this pass.
 *
 * PURE FUNCTION.
 */
export function decide_retry_action(input: RetryDecisionInput): RetryAction {
  if (input.sync_succeeded) {
    return "recovered";
  }

  if (input.transient_since_ms === null) {
    // No anchor yet — start the clock; don't surface on the first sighting.
    return "keep_waiting";
  }

  const elapsed_ms = input.now_ms - input.transient_since_ms;
  return elapsed_ms >= input.surface_after_ms ? "escalate" : "keep_waiting";
}
