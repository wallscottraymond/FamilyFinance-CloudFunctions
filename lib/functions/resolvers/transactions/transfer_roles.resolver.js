"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_transfer_roles = resolve_transfer_roles;
const transaction_repo_1 = require("../../repositories/transaction.repo");
const sharing_1 = require("../../repositories/sharing");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
const edge_transfers_service_1 = require("../../domain/periods/edge_transfers.service");
const derive_scope_service_1 = require("../../domain/periods/derive_scope.service");
const on_read_matching_1 = require("../shared/on_read_matching");
const derive_scope_resolver_1 = require("../periods/derive_scope.resolver");
/** The pairing window's slack each side — THE shared one (the period page pairs the same). */
const PAIRING_BUFFER_MS = edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
/** Roles for one view, for the user's own transfer transactions in [from, to]. PURE given IO. */
function roles_in_view(scope, user_id, member_txns, pairing_extra, catalog, from_ms, to_ms, out) {
    const date = (t) => t.data.transactionDate.toMillis();
    // The VIEW comes only from the members' own transactions; the pairing pool also covers the
    // known group accounts (D12) — added AFTER the view filter so they can't leak into it.
    const view = member_txns.filter((t) => (0, derive_scope_service_1.transaction_in_scope)(scope, t.data.accountId, date(t)));
    const all_member_txns = [...member_txns, ...pairing_extra];
    const { internal_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(view, catalog);
    const crossing = (0, edge_transfers_service_1.find_crossing_transfers)((0, on_read_matching_1.detect_internal_transfers_from_txns)(all_member_txns.filter((t) => !internal_ids.has(t.id)), catalog), internal_ids, view, (d) => (0, on_read_matching_1.txn_effective_category)(d, catalog));
    for (const t of view) {
        if (t.data.userId !== user_id)
            continue;
        const ms = date(t);
        if (ms < from_ms || ms > to_ms)
            continue;
        if (!(0, category_semantics_service_1.is_transfer_category)((0, on_read_matching_1.txn_effective_category)(t.data, catalog)))
            continue;
        out.set(t.id, internal_ids.has(t.id)
            ? "internal"
            : crossing.out_ids.has(t.id)
                ? "edge_out"
                : crossing.in_ids.has(t.id)
                    ? "edge_in"
                    : "external");
    }
}
/**
 * @param own_txns - The user's active transactions over [from − buffer, to + buffer] when the
 *   caller already has them (the classifier does) — saves that read.
 */
async function resolve_transfer_roles(ctx, user_id, from_ms, to_ms, catalog, own_txns) {
    const lo = from_ms - PAIRING_BUFFER_MS;
    const hi = to_ms + PAIRING_BUFFER_MS;
    const load = (m) => m === user_id && own_txns ? Promise.resolve(own_txns) : transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, m, lo, hi);
    const out = new Map();
    // Me: the user's private accounts (+ pre-share history); pairing also sees their groups'
    // shared accounts (D12 — never counted).
    const me = await (0, derive_scope_resolver_1.resolve_derive_scope)(ctx, user_id, { kind: "me" });
    const mine = await load(user_id);
    roles_in_view(me, user_id, mine, await (0, derive_scope_resolver_1.load_pairing_extra_txns)(ctx, me, lo, hi), catalog, from_ms, to_ms, out);
    // Each group the user shares an account with: that account's transactions count there. Read
    // the group's members only when the user HAS transfers on those accounts in the window (reads).
    const shared_transfer = mine.some((t) => {
        var _a;
        return me.exclude_account_ids.has((_a = t.data.accountId) !== null && _a !== void 0 ? _a : "") &&
            (0, category_semantics_service_1.is_transfer_category)((0, on_read_matching_1.txn_effective_category)(t.data, catalog));
    });
    if (shared_transfer) {
        for (const g of await sharing_1.group_repo.get_for_user(ctx, user_id)) {
            const scope = await (0, derive_scope_resolver_1.resolve_derive_scope)(ctx, user_id, { kind: "group", group_id: g.id });
            const members = (await Promise.all(scope.member_ids.map((m) => load(m)))).flat();
            roles_in_view(scope, user_id, members, await (0, derive_scope_resolver_1.load_pairing_extra_txns)(ctx, scope, lo, hi), catalog, from_ms, to_ms, out);
        }
    }
    return out;
}
//# sourceMappingURL=transfer_roles.resolver.js.map