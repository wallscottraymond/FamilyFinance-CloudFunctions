/**
 * Plaid Re-auth Recovery — Domain Unit Tests
 *
 * Pure functions, no mocks. Verifies when an item that needed re-authentication
 * counts as working again (after in-app update mode, or a repair elsewhere).
 */

import {
  is_reauth_recovered,
  needs_consent_check,
} from "../reauth_recovery.service";
import { CONSENT_RENEWED_AFTER_MS } from "../../../types/plaid/reauth_recovery.types";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const ok = { accounts_ok: true, consent_expiration_ms: null, consent_checked: false };
const failed = { accounts_ok: false, consent_expiration_ms: null, consent_checked: false };

describe("needs_consent_check", () => {
  it("checks consent only for an expiring consent", () => {
    expect(needs_consent_check("pending_expiration")).toBe(true);
    expect(needs_consent_check("item_login_required")).toBe(false);
    expect(needs_consent_check("good")).toBe(false);
  });
});

describe("is_reauth_recovered — item_login_required", () => {
  it("recovers when /accounts/get works again", () => {
    expect(is_reauth_recovered("item_login_required", ok, NOW)).toBe(true);
  });

  it("does not recover while /accounts/get still fails", () => {
    expect(is_reauth_recovered("item_login_required", failed, NOW)).toBe(false);
  });
});

describe("is_reauth_recovered — pending_expiration", () => {
  it("does not recover just because the item still works", () => {
    // The connection keeps working until the consent runs out.
    expect(is_reauth_recovered("pending_expiration", ok, NOW)).toBe(false);
  });

  it("does not recover when the consent check failed", () => {
    const probe = { accounts_ok: true, consent_expiration_ms: null, consent_checked: false };
    expect(is_reauth_recovered("pending_expiration", probe, NOW)).toBe(false);
  });

  it("does not recover while the consent is still inside the 7-day warning window", () => {
    const probe = { accounts_ok: true, consent_expiration_ms: NOW + 3 * DAY, consent_checked: true };
    expect(is_reauth_recovered("pending_expiration", probe, NOW)).toBe(false);
  });

  it("does not recover exactly at the window edge", () => {
    const probe = {
      accounts_ok: true,
      consent_expiration_ms: NOW + CONSENT_RENEWED_AFTER_MS,
      consent_checked: true,
    };
    expect(is_reauth_recovered("pending_expiration", probe, NOW)).toBe(false);
  });

  it("recovers once the consent was renewed past the window", () => {
    const probe = { accounts_ok: true, consent_expiration_ms: NOW + 365 * DAY, consent_checked: true };
    expect(is_reauth_recovered("pending_expiration", probe, NOW)).toBe(true);
  });

  it("recovers when the institution reports no expiration at all", () => {
    const probe = { accounts_ok: true, consent_expiration_ms: null, consent_checked: true };
    expect(is_reauth_recovered("pending_expiration", probe, NOW)).toBe(true);
  });

  it("does not recover when /accounts/get fails even with a renewed consent", () => {
    const probe = { accounts_ok: false, consent_expiration_ms: NOW + 365 * DAY, consent_checked: true };
    expect(is_reauth_recovered("pending_expiration", probe, NOW)).toBe(false);
  });
});
