/**
 * Re-authentication Recovery Service
 *
 * Pure decisions for whether an item that needed re-authentication works again.
 *
 * @module domain/plaid/reauth_recovery
 */

import {
  CONSENT_RENEWED_AFTER_MS,
  ReauthProbeResult,
} from "../../types/plaid/reauth_recovery.types";

/**
 * Whether the probe needs `/item/get` (consent) in addition to `/accounts/get`.
 * Only an expiring consent is judged by its expiration date.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param status - Current item status
 * @returns True when the consent expiration must be checked
 */
export function needs_consent_check(status: string): boolean {
  return status === "pending_expiration";
}

/**
 * Decides whether an item has recovered.
 *
 * - `item_login_required` (and other broken states): recovered when
 *   `/accounts/get` succeeds again.
 * - `pending_expiration`: the item still works while the consent runs down, so a
 *   working `/accounts/get` proves nothing. It has recovered only when the
 *   consent was renewed: no expiration at all, or one further out than the
 *   7-day warning window.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param status - Current item status
 * @param probe - What the Plaid probe observed
 * @param now_ms - Current time in ms
 * @returns True when the item should be marked healthy
 */
export function is_reauth_recovered(
  status: string,
  probe: ReauthProbeResult,
  now_ms: number
): boolean {
  if (!probe.accounts_ok) {
    return false;
  }
  if (!needs_consent_check(status)) {
    return true;
  }
  if (!probe.consent_checked) {
    return false;
  }
  if (probe.consent_expiration_ms === null) {
    return true;
  }
  return probe.consent_expiration_ms - now_ms > CONSENT_RENEWED_AFTER_MS;
}
