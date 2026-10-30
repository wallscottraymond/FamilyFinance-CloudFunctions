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
import { DomainResult } from "../../types";
import { Group, SharingRequest } from "../../types/sharing.types";
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
export declare function account_fingerprint(a: PlaceableAccount): string | null;
/** "Joint Checking ••1234" */
export declare function account_label(a: PlaceableAccount): string;
export interface SharePlanInput {
    account: PlaceableAccount | null;
    caller_id: string;
    group: Group | null;
    include_history: boolean;
    /** "From today on": the start of the user's LOCAL today as a UTC date (Plaid dates are UTC
     *  midnights) — from the app. Absent (older app): the start of the UTC day 12h ago. */
    share_from_ms?: number | null;
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
export declare function plan_share_account(input: SharePlanInput): DomainResult<SharePlan>;
/**
 * A member accepted a share request: the placement to apply, if the account is
 * still the sender's, still active, still private, and the group still includes
 * both people.
 */
export declare function placement_on_accept(request: SharingRequest, account: PlaceableAccount | null, group: Group | null, now_ms: number): DomainResult<Placement>;
/** The owner makes an account private again. */
export declare function plan_unshare_account(account: PlaceableAccount | null, caller_id: string): DomainResult<{
    was_group_id: string;
}>;
/**
 * Accounts that leave a group when people leave it (D13). `leaving` = the uids
 * leaving, or "all" when the group is deleted. Returns account ids to make private.
 *
 * Derive must ALSO ignore any account whose owner isn't a current member, so a
 * failed write here can never keep someone's account visible after they leave.
 */
export declare function placements_released(group_accounts: PlaceableAccount[], group_id: string, leaving: string[] | "all"): string[];
/** Pending requests that die with a departure: anything from or to the leavers. */
export declare function requests_released(pending: SharingRequest[], leaving: string[] | "all"): SharingRequest[];
//# sourceMappingURL=placement.service.d.ts.map