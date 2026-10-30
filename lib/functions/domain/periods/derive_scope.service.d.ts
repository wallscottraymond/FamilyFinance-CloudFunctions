/**
 * Derive Scope (Account-Rooted-Sharing D2, D5, P1, N9; Rules §4.2–4.3, §5.1)
 *
 * Which money a derived view counts:
 *   - Me: everything the user owns EXCEPT accounts they've shared with a group
 *     (each account lives in exactly one view). A transaction / bill / goal with
 *     no account, or an account we don't know, stays in Me — so a user who shares
 *     nothing gets EXACTLY today's numbers.
 *   - Group: only accounts shared with that group whose owner is still a member
 *     (a failed release on leave can never keep someone's money visible), and
 *     only their transactions on/after each account's share-from date.
 *
 * Accounts are matched by EITHER their document id or their Plaid account id
 * (transactions / bills store the Plaid id; goals store the document id).
 *
 * PURE: no IO.
 *
 * @module domain/periods/derive_scope
 */
/** What the caller asked for. */
export type DeriveScopeRequest = {
    kind: "me";
} | {
    kind: "group";
    group_id: string;
};
/** A shared account as the scope needs it. */
export interface ScopeAccount {
    doc_id: string;
    plaid_account_id: string | null;
    owner_id: string;
    /** null = all history (N9). */
    shared_from_ms: number | null;
}
/** A resolved scope: what to load and how to filter it. */
export interface DeriveScope {
    kind: "me" | "group";
    /** Owner key of the view's budgets: uid, or "group:<id>" (PD6). */
    budget_owner_key: string;
    /** People whose transactions / bills / income / goals are loaded, then filtered. */
    member_ids: string[];
    /** Group: the ONLY accounts that count (by doc + Plaid id). Me: null (no allow-list). */
    include_account_ids: Set<string> | null;
    /** Me: the user's shared accounts (they count in their group instead). */
    exclude_account_ids: Set<string>;
    /** Account id (doc or Plaid) → share-from (ms) or null for all history. Group: when its
     *  transactions start counting there. Me: for the user's shared accounts, transactions
     *  BEFORE this date stay in Me (N9: earlier history stays private). */
    shared_from: Map<string, number | null>;
    /** Group id when kind = group. */
    group_id: string | null;
    /**
     * Extra transactions to load ONLY for pairing transfers (D12): accounts the viewer knows that
     * aren't the view's own members' — for Me, the shared accounts of the user's groups (owned by
     * other members). Never counted; just lets a transfer into a group account be seen as one.
     */
    pairing_extra: {
        member_ids: string[];
        account_ids: Set<string>;
    } | null;
}
/** Me scope: exclude the user's own shared accounts. */
export declare function build_me_scope(user_id: string, my_shared_accounts: Array<Pick<ScopeAccount, "doc_id" | "plaid_account_id"> & {
    shared_from_ms?: number | null;
}>, my_groups_accounts?: ScopeAccount[]): DeriveScope;
/** Group scope: only accounts shared with it whose owner is a current member. */
export declare function build_group_scope(group_id: string, member_ids: string[], shared_accounts: ScopeAccount[]): DeriveScope;
/** Does an item tied to `account_id` (bill, income stream, goal) belong to this view? */
export declare function account_in_scope(scope: DeriveScope, account_id: string | null | undefined): boolean;
/** Does a transaction count in this view (account + share-from date)? */
export declare function transaction_in_scope(scope: DeriveScope, account_id: string | null | undefined, date_ms: number): boolean;
/**
 * A group view's cache version: a fingerprint of everything that can change its numbers —
 * who's in it, the group's own version (its budgets), and every member's version (their
 * transactions / bills / placements). Any member edit or membership change → new version.
 * Deterministic; a safe integer (52 bits of a SHA-1). PURE.
 */
export declare function group_view_version(member_ids: string[], group_version: number, member_versions: Record<string, number>): number;
/**
 * A Me view's cache version. With no groups it is the user's own version, unchanged. In a
 * group, Me also pairs transfers against other members' transactions on the group's shared
 * accounts (D12), so it fingerprints the user's own version, each group + its members, and
 * every other member's version: a partner's sync, share/unshare, or any join/leave moves it.
 * Deterministic; a safe integer. PURE.
 */
export declare function me_view_version(own_version: number, groups: Array<{
    id: string;
    member_ids: string[];
}>, member_versions: Record<string, number>): number;
/**
 * A widget's "unchanged" version: the view version plus the UTC day. The widget payload
 * carries day-relative fields (current period, `overdue` vs today's UTC start), so a widget
 * must refetch once per UTC day even when no data changed. Deterministic; a safe integer. PURE.
 */
export declare function widget_view_version(view_version: number, now_ms: number): number;
//# sourceMappingURL=derive_scope.service.d.ts.map