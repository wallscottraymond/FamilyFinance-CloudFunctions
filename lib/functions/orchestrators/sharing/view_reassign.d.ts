/**
 * View-change re-assign (Transaction-Integrity-Review H6): when an account changes view (shared,
 * accepted, unshared, released by a departure) or a view's budgets change (a budget moved
 * between Me and a group), the affected transactions are re-assigned against the budgets of the
 * view they now count in — through the ONE bounded re-assign engine (reassign_user), one run per
 * account owner, scoped to just the accounts that moved. Never throws (a failed enqueue is
 * logged; the next edit / sync re-assigns those transactions anyway).
 *
 * @module orchestrators/sharing/view_reassign
 */
import { TraceContext } from "../../types";
/** A budget counts from the start of the period its start falls in (budget-start period snap), so
 *  a re-home reaches back one period before the earliest start. */
export declare const REHOME_BACK_MS: number;
/**
 * A view change (share / accept / unshare / leave / remove / delete) changes which transfers cross
 * the group's boundary for EVERY member — not only the account's owner: a transfer between two
 * members' accounts can turn from "own accounts" into "leaving the view" (or back). Re-decide every
 * member's transfer roles (coalesced, one per member per burst), plus anyone who just left.
 */
export declare function refresh_group_transfer_roles(ctx: TraceContext, group_id: string | null | undefined, extra_user_ids?: string[]): Promise<void>;
/** Re-assign these accounts' transactions (grouped per owner, scoped to the accounts). */
export declare function reassign_accounts(ctx: TraceContext, accounts: Array<{
    id: string;
    user_id: string;
}>, from_ms?: number, reason?: "view_change" | "budget_categories"): Promise<void>;
/**
 * Re-assign every transaction that counts in a view whose budgets changed: Me = the user's own
 * transactions (unscoped — shared accounts resolve to their group and are left unchanged); a
 * group = each member's accounts shared with it.
 */
export declare function reassign_view(ctx: TraceContext, owner_key: string, from_ms?: number): Promise<void>;
//# sourceMappingURL=view_reassign.d.ts.map