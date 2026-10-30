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
import { TraceContext } from "../../types";
import { CategoryCatalog } from "../../domain/transactions/split_category.service";
export type TransferRole = "internal" | "edge_out" | "edge_in" | "external";
type Txn = {
    id: string;
    data: Record<string, unknown>;
};
/**
 * @param own_txns - The user's active transactions over [from − buffer, to + buffer] when the
 *   caller already has them (the classifier does) — saves that read.
 */
export declare function resolve_transfer_roles(ctx: TraceContext, user_id: string, from_ms: number, to_ms: number, catalog: CategoryCatalog, own_txns?: Txn[]): Promise<Map<string, TransferRole>>;
export {};
//# sourceMappingURL=transfer_roles.resolver.d.ts.map