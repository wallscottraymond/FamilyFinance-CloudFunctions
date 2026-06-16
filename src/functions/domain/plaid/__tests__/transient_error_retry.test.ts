/**
 * Plaid Transient-Error Auto-Retry — Domain Unit Tests
 *
 * Pure functions, no mocks. Verifies error classification, the silent-vs-surface
 * retry decision, and the escalation status update.
 */

import { decide_retry_action } from "../transient_error_retry.service";
import {
  compute_error_update,
  compute_escalation_update,
  is_transient_error_code,
} from "../item_status_webhook.service";
import { ItemStatusValues } from "../../../types/plaid/item_status_webhook.types";
import { SURFACE_AFTER_MS } from "../../../types/plaid/transient_error_retry.types";
import { Timestamp } from "firebase-admin/firestore";

// Injected time (these domain functions are deterministic — time is a param).
const NOW = Timestamp.fromMillis(1_700_000_000_000);

describe("compute_error_update — transient classification", () => {
  it("classifies institution-down as a silent transient error", () => {
    const u = compute_error_update(NOW, "INSTITUTION_DOWN");
    expect(u.status).toBe(ItemStatusValues.TEMPORARY_ERROR);
    expect(u.requires_reauth).toBe(false);
    expect(u.is_transient).toBe(true);
  });

  it("classifies rate limits as a silent rate_limited error", () => {
    const u = compute_error_update(NOW, "RATE_LIMIT_EXCEEDED");
    expect(u.status).toBe(ItemStatusValues.RATE_LIMITED);
    expect(u.requires_reauth).toBe(false);
    expect(u.is_transient).toBe(true);
  });

  it("treats login-required as a surfaced reauth error", () => {
    const u = compute_error_update(NOW, "ITEM_LOGIN_REQUIRED");
    expect(u.status).toBe(ItemStatusValues.ITEM_LOGIN_REQUIRED);
    expect(u.requires_reauth).toBe(true);
    expect(u.is_transient).toBe(false);
  });

  it("defaults an unknown error to surfaced (non-transient)", () => {
    const u = compute_error_update(NOW, "SOMETHING_NEW");
    expect(u.is_transient).toBe(false);
    expect(u.status).toBe(ItemStatusValues.ITEM_LOGIN_REQUIRED);
  });

  it("is_transient_error_code matches transient + rate-limit codes only", () => {
    expect(is_transient_error_code("INSTITUTION_DOWN")).toBe(true);
    expect(is_transient_error_code("RATE_LIMIT_EXCEEDED")).toBe(true);
    expect(is_transient_error_code("ITEM_LOGIN_REQUIRED")).toBe(false);
  });
});

describe("decide_retry_action", () => {
  const T0 = 1_000_000_000_000; // arbitrary fixed epoch ms

  it("recovers when the sync probe succeeds", () => {
    expect(
      decide_retry_action({
        transient_since_ms: T0,
        now_ms: T0 + SURFACE_AFTER_MS * 2,
        sync_succeeded: true,
        surface_after_ms: SURFACE_AFTER_MS,
      })
    ).toBe("recovered");
  });

  it("keeps waiting when still failing within the window", () => {
    expect(
      decide_retry_action({
        transient_since_ms: T0,
        now_ms: T0 + 60 * 60 * 1000, // 1h later
        sync_succeeded: false,
        surface_after_ms: SURFACE_AFTER_MS,
      })
    ).toBe("keep_waiting");
  });

  it("escalates when failing past the surface threshold", () => {
    expect(
      decide_retry_action({
        transient_since_ms: T0,
        now_ms: T0 + SURFACE_AFTER_MS + 1,
        sync_succeeded: false,
        surface_after_ms: SURFACE_AFTER_MS,
      })
    ).toBe("escalate");
  });

  it("keeps waiting (starts the clock) when the anchor is unknown", () => {
    expect(
      decide_retry_action({
        transient_since_ms: null,
        now_ms: T0,
        sync_succeeded: false,
        surface_after_ms: SURFACE_AFTER_MS,
      })
    ).toBe("keep_waiting");
  });
});

describe("compute_escalation_update", () => {
  it("surfaces as reauth, preserving the original error code", () => {
    const u = compute_escalation_update(NOW, "INSTITUTION_DOWN");
    expect(u.status).toBe(ItemStatusValues.ITEM_LOGIN_REQUIRED);
    expect(u.requires_reauth).toBe(true);
    expect(u.is_transient).toBe(false);
    expect(u.error_code).toBe("INSTITUTION_DOWN");
  });

  it("falls back to a generic code when none is given", () => {
    const u = compute_escalation_update(NOW, null);
    expect(u.error_code).toBe("PERSISTENT_CONNECTION_ERROR");
  });
});
