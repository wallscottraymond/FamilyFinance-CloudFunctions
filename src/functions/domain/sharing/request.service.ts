/**
 * Requests (D25, D26)
 *
 * Every offer (v1: "join this group") reaches the other person as a request they
 * accept or decline. Requests expire after 7 days. A sender can send to at most
 * 5 different people per rolling 24 hours, so nobody can mass-spam offers.
 *
 * PURE: ids and time are passed in.
 *
 * @module domain/sharing/request
 */

import { PersonReport, SharingRequest } from "../../types/sharing.types";
import { DomainResult, success, validation_failed } from "../../types";

export const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DAILY_RECIPIENT_LIMIT = 5;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_REPORT_REASON_LENGTH = 500;

/**
 * Checks the 5-people-a-day limit. `recent` = requests this sender created in the
 * last 24h. A person already sent to today doesn't count again.
 */
export function check_daily_recipient_limit(
  recent: Pick<SharingRequest, "to_user_id" | "created_at_ms">[],
  new_recipients: string[],
  now_ms: number
): string[] {
  const today = new Set(
    recent.filter((r) => now_ms - r.created_at_ms < DAY_MS).map((r) => r.to_user_id)
  );
  for (const uid of new_recipients) today.add(uid);
  if (today.size > DAILY_RECIPIENT_LIMIT) {
    return [
      `You can send to up to ${DAILY_RECIPIENT_LIMIT} people a day. Try again tomorrow.`,
    ];
  }
  return [];
}

/** A pending join request. */
export function build_join_request(
  id: string,
  from_user_id: string,
  to_user_id: string,
  group_id: string,
  now_ms: number
): SharingRequest {
  return {
    id,
    type: "join_group",
    from_user_id,
    to_user_id,
    group_id,
    status: "pending",
    created_at_ms: now_ms,
    expires_at_ms: now_ms + REQUEST_TTL_MS,
    responded_at_ms: null,
  };
}

/** True while a request can still be answered. */
export function is_open(request: SharingRequest, now_ms: number): boolean {
  return request.status === "pending" && request.expires_at_ms > now_ms;
}

/**
 * Validates that the caller may answer this request and returns it with the
 * answer applied. Group-side checks (limits, membership) happen separately.
 */
export function answer_request(
  request: SharingRequest | null,
  caller_id: string,
  accept: boolean,
  now_ms: number
): DomainResult<SharingRequest> {
  if (!request || request.to_user_id !== caller_id) {
    return validation_failed(["This request isn't available"]);
  }
  if (!is_open(request, now_ms)) {
    return validation_failed(["This request has expired or was already answered"]);
  }
  return success({
    ...request,
    status: accept ? "accepted" : "declined",
    responded_at_ms: now_ms,
  });
}

/** Marks requests cancelled (e.g. the group was deleted, or the pair got blocked). */
export function cancel_requests(
  requests: SharingRequest[],
  now_ms: number
): SharingRequest[] {
  return requests
    .filter((r) => r.status === "pending")
    .map((r) => ({ ...r, status: "cancelled" as const, responded_at_ms: now_ms }));
}

/** A report of another person (D27). */
export function build_report(
  id: string,
  reporter_id: string,
  reported_id: string,
  reason: string,
  now_ms: number
): DomainResult<PersonReport> {
  const text = reason.trim();
  if (reporter_id === reported_id) return validation_failed(["You can't report yourself"]);
  if (text.length > MAX_REPORT_REASON_LENGTH) {
    return validation_failed([`Keep it under ${MAX_REPORT_REASON_LENGTH} characters`]);
  }
  return success({
    id,
    reporter_id,
    reported_id,
    reason: text,
    created_at_ms: now_ms,
  });
}
