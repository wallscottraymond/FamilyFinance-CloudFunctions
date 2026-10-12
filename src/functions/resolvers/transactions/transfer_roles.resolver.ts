/**
 * Transfer roles (Transaction-Integrity-Review 3d, canon A7) — what each of a user's transfer
 * transactions IS in the view it counts in, decided EXACTLY as the period page decides it (same
 * scope, same two-stage matched-pair pairing, same edge rule — Account-Rooted-Sharing D12):
 *
 *   internal  — paired with an opposite transfer on another account INSIDE its view (counts 0)
 *   edge_out  — paired across the view boundary, money leaving the view → spending
 *   edge_in   — paired across the view boundary, money entering the view → other income
 *   external  — no pair (e.g. an ACH bill Plaid tags TRANSFER_OUT)
 *
 * The assignment engine reads the stored role so the transaction screen and the period page
 * agree (an edge_out contribution to a joint account counts in Me's Everything Else on both).
 * Only the user's OWN transfer-category transactions get a role.
 *
 * @module resolvers/transactions/transfer_roles
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { group_repo } from "../../repositories/sharing";
import { CategoryCatalog } from "../../domain/transactions/split_category.service";
import { is_transfer_category } from "../../domain/transactions/category_semantics.service";
import { find_crossing_transfers } from "../../domain/periods/edge_transfers.service";
import { transaction_in_scope, DeriveScope } from "../../domain/periods/derive_scope.service";
import {
  detect_internal_transfers_from_txns,
  txn_effective_category,
} from "../shared/on_read_matching";
import { load_pairing_extra_txns, resolve_derive_scope } from "../periods/derive_scope.resolver";

export type TransferRole = "internal" | "edge_out" | "edge_in" | "external";

type Txn = { id: string; data: Record<string, unknown> };

/** The pairing window's slack each side (as on the period page). */
const PAIRING_BUFFER_MS = 5 * 24 * 60 * 60 * 1000;

/** Roles for one view, for the user's own transfer transactions in [from, to]. PURE given IO. */
function roles_in_view(
  scope: DeriveScope,
  user_id: string,
  member_txns: Txn[],
  pairing_extra: Txn[],
  catalog: CategoryCatalog,
  from_ms: number,
  to_ms: number,
  out: Map<string, TransferRole>
): void {
  const date = (t: Txn) => (t.data.transactionDate as Timestamp).toMillis();
  // The VIEW comes only from the members' own transactions; the pairing pool also covers the
  // known group accounts (D12) — added AFTER the view filter so they can't leak into it.
  const view = member_txns.filter((t) =>
    transaction_in_scope(scope, t.data.accountId as string | undefined, date(t))
  );
  const all_member_txns = [...member_txns, ...pairing_extra];
  const { internal_ids } = detect_internal_transfers_from_txns(view, catalog);
  const crossing = find_crossing_transfers(
    detect_internal_transfers_from_txns(
      all_member_txns.filter((t) => !internal_ids.has(t.id)),
      catalog
    ),
    internal_ids,
    view,
    (d) => txn_effective_category(d, catalog)
  );
  for (const t of view) {
    if (t.data.userId !== user_id) continue;
    const ms = date(t);
    if (ms < from_ms || ms > to_ms) continue;
    if (!is_transfer_category(txn_effective_category(t.data, catalog))) continue;
    out.set(
      t.id,
      internal_ids.has(t.id)
        ? "internal"
        : crossing.out_ids.has(t.id)
          ? "edge_out"
          : crossing.in_ids.has(t.id)
            ? "edge_in"
            : "external"
    );
  }
}

/**
 * @param own_txns - The user's active transactions over [from − buffer, to + buffer] when the
 *   caller already has them (the classifier does) — saves that read.
 */
export async function resolve_transfer_roles(
  ctx: TraceContext,
  user_id: string,
  from_ms: number,
  to_ms: number,
  catalog: CategoryCatalog,
  own_txns?: Txn[]
): Promise<Map<string, TransferRole>> {
  const lo = from_ms - PAIRING_BUFFER_MS;
  const hi = to_ms + PAIRING_BUFFER_MS;
  const load = (m: string) =>
    m === user_id && own_txns ? Promise.resolve(own_txns) : transaction_repo.get_active_in_date_range(ctx, m, lo, hi);
  const out = new Map<string, TransferRole>();

  // Me: the user's private accounts (+ pre-share history); pairing also sees their groups'
  // shared accounts (D12 — never counted).
  const me = await resolve_derive_scope(ctx, user_id, { kind: "me" });
  const mine = await load(user_id);
  roles_in_view(
    me,
    user_id,
    mine,
    await load_pairing_extra_txns(ctx, me, lo, hi),
    catalog,
    from_ms,
    to_ms,
    out
  );

  // Each group the user shares an account with: that account's transactions count there.
  if (me.exclude_account_ids.size > 0) {
    for (const g of await group_repo.get_for_user(ctx, user_id)) {
      const scope = await resolve_derive_scope(ctx, user_id, { kind: "group", group_id: g.id });
      const members = (
        await Promise.all(scope.member_ids.map((m) => load(m)))
      ).flat();
      roles_in_view(
        scope,
        user_id,
        members,
        await load_pairing_extra_txns(ctx, scope, lo, hi),
        catalog,
        from_ms,
        to_ms,
        out
      );
    }
  }
  return out;
}
