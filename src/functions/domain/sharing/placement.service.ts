/**
 * Account Placement (P1, D7, N9, I4, D25)
 *
 * An account is private (its owner's Me view) or shared with exactly one group.
 * Only the account's owner shares or unshares it. Sharing into a group with
 * other members sends each of them a request; the first Accept applies it
 * (PD5). In a group of one it applies at once. Unsharing needs no Accept.
 *
 * PURE: ids and time are passed in.
 *
 * @module domain/sharing/placement
 */

import { DomainResult, success, validation_failed } from "../../types";
import { Group, SharingRequest } from "../../types/sharing.types";
import { REQUEST_TTL_MS, check_daily_recipient_limit, is_open } from "./request.service";
import { is_member } from "./group.service";

/** The bits of an account placement rules need (decoupled from the repo shape). */
export interface PlaceableAccount {
  id: string;
  user_id: string;
  is_active: boolean;
  name: string;
  mask: string | null;
  institution_id: string;
  account_subtype: string;
  placement: {
    group_id: string;
    shared_from_ms: number | null;
    shared_by: string;
    shared_at_ms: number;
  } | null;
}

export type Placement = NonNullable<PlaceableAccount["placement"]>;

/** Same bank + last 4 + subtype = the same real account linked twice (I4). */
export function account_fingerprint(a: PlaceableAccount): string | null {
  if (!a.mask || !a.institution_id) return null;
  return `${a.institution_id}|${a.mask}|${a.account_subtype}`;
}

/** "Joint Checking ••1234" */
export function account_label(a: PlaceableAccount): string {
  return a.mask ? `${a.name} ••${a.mask}` : a.name;
}

export interface SharePlanInput {
  account: PlaceableAccount | null;
  caller_id: string;
  group: Group | null;
  include_history: boolean;
  /** Active accounts already shared with the group (any owner). */
  group_accounts: PlaceableAccount[];
  /** Pending share requests for this account (to avoid duplicates). */
  pending_for_account: SharingRequest[];
  /** Requests the caller sent in the last 24h (D26). */
  sent_today: Pick<SharingRequest, "to_user_id" | "created_at_ms">[];
  now_ms: number;
  new_request_id: () => string;
}

export interface SharePlan {
  /** Set when the share applies now (group of one). */
  placement: Placement | null;
  /** Requests to send (group with other members). */
  requests: SharingRequest[];
  /** When a duplicate blocks sharing: who already shares the same real account. */
  duplicate_owner_id: string | null;
}

/** Decides what sharing an account with a group does. */
export function plan_share_account(input: SharePlanInput): DomainResult<SharePlan> {
  const { account, caller_id, group, now_ms } = input;
  if (!account || !account.is_active || account.user_id !== caller_id) {
    return validation_failed(["Only the account's owner can share it"]);
  }
  if (!is_member(group, caller_id)) return validation_failed(["You're not in this group"]);
  if (account.placement) {
    return validation_failed([
      account.placement.group_id === group!.id
        ? "This account is already shared with this group"
        : "This account is shared with another group. Make it private first.",
    ]);
  }
  const fp = account_fingerprint(account);
  const dup = fp
    ? input.group_accounts.find((g) => g.id !== account.id && account_fingerprint(g) === fp)
    : undefined;
  if (dup) {
    return {
      entity: { placement: null, requests: [], duplicate_owner_id: dup.user_id },
      validation_errors: ["Someone in this group already shares this account"],
    };
  }
  if (input.pending_for_account.some((r) => is_open(r, now_ms))) {
    return validation_failed(["This account is already waiting for someone to accept"]);
  }

  const shared_from_ms = input.include_history ? null : now_ms;
  const others = group!.member_ids.filter((uid) => uid !== caller_id);
  if (others.length === 0) {
    return success({
      placement: {
        group_id: group!.id,
        shared_from_ms,
        shared_by: caller_id,
        shared_at_ms: now_ms,
      },
      requests: [],
      duplicate_owner_id: null,
    });
  }
  const limit = check_daily_recipient_limit(input.sent_today, others, now_ms);
  if (limit.length) return validation_failed(limit);
  return success({
    placement: null,
    requests: others.map((to) => ({
      id: input.new_request_id(),
      type: "share_account" as const,
      from_user_id: caller_id,
      to_user_id: to,
      group_id: group!.id,
      target_id: account.id,
      target_label: account_label(account),
      shared_from_ms,
      status: "pending" as const,
      created_at_ms: now_ms,
      expires_at_ms: now_ms + REQUEST_TTL_MS,
      responded_at_ms: null,
    })),
    duplicate_owner_id: null,
  });
}

/**
 * A member accepted a share request: the placement to apply, if the account is
 * still the sender's, still active, still private, and the group still includes
 * both people.
 */
export function placement_on_accept(
  request: SharingRequest,
  account: PlaceableAccount | null,
  group: Group | null,
  now_ms: number
): DomainResult<Placement> {
  if (request.type !== "share_account") return validation_failed(["Not a share request"]);
  if (
    !account ||
    !account.is_active ||
    account.user_id !== request.from_user_id ||
    account.id !== request.target_id
  ) {
    return validation_failed(["This account is no longer available"]);
  }
  if (!is_member(group, request.from_user_id) || !is_member(group, request.to_user_id)) {
    return validation_failed(["This group has changed. Ask them to share again."]);
  }
  if (account.placement) {
    return account.placement.group_id === request.group_id
      ? success(account.placement) // another member accepted first
      : validation_failed(["This account is now shared somewhere else"]);
  }
  return success({
    group_id: request.group_id,
    shared_from_ms: request.shared_from_ms,
    shared_by: request.from_user_id,
    shared_at_ms: now_ms,
  });
}

/** The owner makes an account private again. */
export function plan_unshare_account(
  account: PlaceableAccount | null,
  caller_id: string
): DomainResult<{ was_group_id: string }> {
  if (!account || account.user_id !== caller_id) {
    return validation_failed(["Only the account's owner can change its sharing"]);
  }
  if (!account.placement) return validation_failed(["This account is already private"]);
  return success({ was_group_id: account.placement.group_id });
}
