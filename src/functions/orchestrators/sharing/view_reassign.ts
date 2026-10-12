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
import { enqueue_reassign_user } from "../transactions/reassign_user.orchestrator";
import { resolve_group_accounts } from "../../resolvers/sharing/sharing.resolver";
import { group_id_of_key } from "../../domain/sharing/budget_view.service";
import { account_repo } from "../../repositories/account.repo";
import { coalesce_job } from "../../infrastructure/job_queue";
import { CLASSIFY_TRANSFERS_JOB } from "../plaid/classify_internal_transfers.orchestrator";

/** A budget counts from the start of the period its start falls in (budget-start period snap), so
 *  a re-home reaches back one period before the earliest start. */
export const REHOME_BACK_MS = 31 * 24 * 60 * 60 * 1000;

/** Re-assign these accounts' transactions (grouped per owner, scoped to the accounts). */
export async function reassign_accounts(
  ctx: TraceContext,
  accounts: Array<{ id: string; user_id: string }>,
  from_ms?: number,
  reason: "view_change" | "budget_categories" = "view_change"
): Promise<void> {
  // A transaction's `accountId` may be the account doc id or its Plaid account id — scope both.
  const docs = await Promise.all(
    accounts.map((a) => account_repo.get_by_id(ctx, a.id).catch(() => null))
  );
  const by_owner = new Map<string, string[]>();
  accounts.forEach((a, i) => {
    if (!a.user_id) return;
    const ids = [a.id, docs[i]?.account_id].filter((x): x is string => !!x);
    by_owner.set(a.user_id, [...(by_owner.get(a.user_id) ?? []), ...ids]);
  });
  for (const [user_id, account_ids] of by_owner) {
    // The accounts' view changed, so which transfers pair INSIDE a view (and which cross it)
    // changed too: re-decide the owner's transfer roles (coalesced) before / alongside.
    await coalesce_job(
      CLASSIFY_TRANSFERS_JOB,
      { deduplication_key: `classify:${user_id}`, user_id },
      { delay_seconds: 0, trace_id: ctx.trace_id }
    ).catch(() => {});
    try {
      await enqueue_reassign_user(
        { user_id, reason, scope: { account_ids, ...(from_ms !== undefined ? { from_ms } : {}) } },
        ctx.trace_id
      );
    } catch (error) {
      console.error(`[${ctx.trace_id}] view re-assign enqueue failed for ${user_id}:`, error);
    }
  }
}

/**
 * Re-assign every transaction that counts in a view whose budgets changed: Me = the user's own
 * transactions (unscoped — shared accounts resolve to their group and are left unchanged); a
 * group = each member's accounts shared with it.
 */
export async function reassign_view(
  ctx: TraceContext,
  owner_key: string,
  from_ms?: number
): Promise<void> {
  const gid = group_id_of_key(owner_key);
  if (!gid) {
    try {
      await enqueue_reassign_user(
        {
          user_id: owner_key,
          reason: "budget_categories",
          ...(from_ms !== undefined ? { scope: { from_ms } } : {}),
        },
        ctx.trace_id
      );
    } catch (error) {
      console.error(`[${ctx.trace_id}] view re-assign enqueue failed for ${owner_key}:`, error);
    }
    return;
  }
  const accounts = await resolve_group_accounts(ctx, gid).catch(() => []);
  await reassign_accounts(
    ctx,
    accounts.map((a) => ({ id: a.id, user_id: a.user_id })),
    from_ms,
    "budget_categories"
  );
}
