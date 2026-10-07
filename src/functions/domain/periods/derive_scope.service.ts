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

import { createHash } from "crypto";

/** What the caller asked for. */
export type DeriveScopeRequest = { kind: "me" } | { kind: "group"; group_id: string };

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
  pairing_extra: { member_ids: string[]; account_ids: Set<string> } | null;
}

/** Me scope: exclude the user's own shared accounts. */
export function build_me_scope(
  user_id: string,
  my_shared_accounts: Array<Pick<ScopeAccount, "doc_id" | "plaid_account_id"> & {
    shared_from_ms?: number | null;
  }>,
  my_groups_accounts: ScopeAccount[] = []
): DeriveScope {
  const exclude = new Set<string>();
  const shared_from = new Map<string, number | null>();
  for (const a of my_shared_accounts) {
    for (const id of [a.doc_id, a.plaid_account_id]) {
      if (!id) continue;
      exclude.add(id);
      shared_from.set(id, a.shared_from_ms ?? null);
    }
  }
  // Accounts of the user's groups owned by OTHER members: known to the user, so a transfer
  // between one of them and the user's own account is a transfer, not outside money (D12).
  const extra_members = new Set<string>();
  const extra_accounts = new Set<string>();
  for (const a of my_groups_accounts) {
    if (a.owner_id === user_id) continue;
    extra_members.add(a.owner_id);
    if (a.plaid_account_id) extra_accounts.add(a.plaid_account_id);
    extra_accounts.add(a.doc_id);
  }
  return {
    kind: "me",
    budget_owner_key: user_id,
    member_ids: [user_id],
    include_account_ids: null,
    exclude_account_ids: exclude,
    shared_from,
    group_id: null,
    pairing_extra: extra_members.size
      ? { member_ids: [...extra_members], account_ids: extra_accounts }
      : null,
  };
}

/** Group scope: only accounts shared with it whose owner is a current member. */
export function build_group_scope(
  group_id: string,
  member_ids: string[],
  shared_accounts: ScopeAccount[]
): DeriveScope {
  const members = new Set(member_ids);
  const include = new Set<string>();
  const shared_from = new Map<string, number | null>();
  for (const a of shared_accounts) {
    if (!members.has(a.owner_id)) continue; // owner left: never counts here
    for (const id of [a.doc_id, a.plaid_account_id]) {
      if (!id) continue;
      include.add(id);
      shared_from.set(id, a.shared_from_ms);
    }
  }
  return {
    kind: "group",
    budget_owner_key: `group:${group_id}`,
    member_ids: [...members],
    include_account_ids: include,
    exclude_account_ids: new Set(),
    shared_from,
    group_id,
    pairing_extra: null,
  };
}

/** Does an item tied to `account_id` (bill, income stream, goal) belong to this view? */
export function account_in_scope(
  scope: DeriveScope,
  account_id: string | null | undefined
): boolean {
  if (scope.include_account_ids) {
    return !!account_id && scope.include_account_ids.has(account_id);
  }
  return !account_id || !scope.exclude_account_ids.has(account_id);
}

/** Does a transaction count in this view (account + share-from date)? */
export function transaction_in_scope(
  scope: DeriveScope,
  account_id: string | null | undefined,
  date_ms: number
): boolean {
  const from = account_id ? scope.shared_from.get(account_id) : undefined;
  if (!scope.include_account_ids) {
    // Me: a shared account's transactions from BEFORE its share-from date stay private (N9).
    if (account_id && scope.exclude_account_ids.has(account_id)) {
      return from !== null && from !== undefined && date_ms < from;
    }
    return true;
  }
  if (!account_in_scope(scope, account_id)) return false;
  return from === null || from === undefined || date_ms >= from;
}

/**
 * A group view's cache version: a fingerprint of everything that can change its numbers —
 * who's in it, the group's own version (its budgets), and every member's version (their
 * transactions / bills / placements). Any member edit or membership change → new version.
 * Deterministic; a safe integer (52 bits of a SHA-1). PURE.
 */
export function group_view_version(
  member_ids: string[],
  group_version: number,
  member_versions: Record<string, number>
): number {
  const members = [...member_ids].sort();
  const parts = [
    `g=${group_version}`,
    ...members.map((m) => `${m}=${member_versions[m] ?? 0}`),
  ];
  const hex = createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 13);
  return parseInt(hex, 16);
}
