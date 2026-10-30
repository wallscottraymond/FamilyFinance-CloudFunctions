/**
 * Sharing Resolvers (Account-Rooted-Sharing Phase 1)
 *
 * READ-ONLY. Each resolver loads exactly what one sharing operation's domain
 * rule needs. No decisions here: lookups only.
 *
 * @module resolvers/sharing/sharing
 */
import { TraceContext } from "../../types";
import { ConnectCode, Connection, Group, SharingRequest } from "../../types/sharing.types";
import { PlaceableAccount } from "../../domain/sharing/placement.service";
import { Account } from "../../repositories/account.repo";
/** For get_my_connect_code. */
export declare function resolve_my_code(ctx: TraceContext, user_id: string): Promise<{
    existing: ConnectCode | null;
    connection_count: number;
}>;
/** Whether a freshly generated code is already in use by someone else. */
export declare function resolve_code_taken(ctx: TraceContext, code: string, user_id: string, now_ms: number): Promise<boolean>;
export interface CodeEntryDeps {
    caller_code: ConnectCode | null;
    /** The single active code doc matching what was typed (null if 0 or ambiguous). */
    target: ConnectCode | null;
    existing_connection: Connection | null;
    caller_connection_count: number;
    target_connection_count: number;
}
/** For enter_connect_code. */
export declare function resolve_code_entry(ctx: TraceContext, user_id: string, code: string, now_ms: number): Promise<CodeEntryDeps>;
export interface OverviewDeps {
    connections: Connection[];
    groups: Group[];
    requests: SharingRequest[];
    request_groups: Record<string, Group>;
}
/** For get_sharing_overview. */
export declare function resolve_overview(ctx: TraceContext, user_id: string): Promise<OverviewDeps>;
export interface ConnectionActionDeps {
    connection: Connection | null;
    /** Pending requests between the two people, either direction. */
    pending_between: SharingRequest[];
}
/** For manage_connection. */
export declare function resolve_connection_action(ctx: TraceContext, user_id: string, other_user_id: string): Promise<ConnectionActionDeps>;
export interface InviteDeps {
    group: Group | null;
    /** invitee uid → their connection with the caller (null when none). */
    connections: Record<string, Connection | null>;
    /** Requests the caller sent in the last 24h (daily recipient limit). */
    sent_today: SharingRequest[];
}
/** For create_group / add_to_group: the caller's links to each invitee. */
export declare function resolve_invites(ctx: TraceContext, user_id: string, group_id: string | null, invitee_ids: string[], now_ms: number): Promise<InviteDeps>;
/** For respond_to_request. */
export declare function resolve_request(ctx: TraceContext, request_id: string): Promise<{
    request: SharingRequest | null;
    inviter_connection: Connection | null;
}>;
/** For manage_group: pending requests to cancel when a group is deleted. */
export declare function resolve_group_pending_requests(ctx: TraceContext, group_id: string): Promise<SharingRequest[]>;
/** Repo account → the fields placement rules need. */
export declare function to_placeable(a: Account | null): PlaceableAccount | null;
export interface ShareAccountDeps {
    account: PlaceableAccount | null;
    group: Group | null;
    group_accounts: PlaceableAccount[];
    pending_for_account: SharingRequest[];
    sent_today: SharingRequest[];
}
/** For share_account. */
export declare function resolve_share_account(ctx: TraceContext, user_id: string, account_id: string, group_id: string, now_ms: number): Promise<ShareAccountDeps>;
/** For unshare_account and accepting a share request. */
export declare function resolve_account_placement(ctx: TraceContext, account_id: string): Promise<{
    account: PlaceableAccount | null;
    pending: SharingRequest[];
}>;
/** For accepting a share_account request: the account, its pending requests, the group. */
export declare function resolve_share_accept(ctx: TraceContext, request: SharingRequest): Promise<{
    account: PlaceableAccount | null;
    pending: SharingRequest[];
    group: Group | null;
}>;
/** For manage_group leave / remove / delete: accounts shared with the group. */
export declare function resolve_group_accounts(ctx: TraceContext, group_id: string): Promise<PlaceableAccount[]>;
//# sourceMappingURL=sharing.resolver.d.ts.map