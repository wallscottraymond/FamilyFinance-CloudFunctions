/**
 * Who may open, and note, a bill (outflow) or income (inflow) — Account-Rooted-Sharing.
 *
 * A recurring item follows its account: the owner always may; anyone else only when the item's
 * account is shared with a group the caller is a member of AND the owner is still a member (the
 * same rule the group period view uses, `resolve_derive_scope`). The group doc is the membership
 * truth. READ-ONLY.
 *
 * @module resolvers/recurring/recurring_access
 */

import { TraceContext, NotFoundError, PermissionDeniedError } from "../../types";
import { outflow_repo, inflow_repo, account_repo } from "../../repositories";
import { group_repo } from "../../repositories/sharing";
import { is_member } from "../../domain/sharing/group.service";
import { recurring_note_repo } from "../../repositories/recurring_note.repo";
import {
  RecurringNoteKind,
  period_recurring_id,
} from "../../domain/recurring/recurring_note.service";

export interface RecurringAccess {
  owner_id: string;
  /** The group the item is shared through, when the caller isn't the owner. */
  via_group_id: string | null;
}

export async function resolve_recurring_access(
  ctx: TraceContext,
  caller_id: string,
  kind: RecurringNoteKind,
  recurring_id: string
): Promise<RecurringAccess> {
  const item = kind === "outflow"
    ? await outflow_repo.get_by_id(ctx, recurring_id)
    : await inflow_repo.get_by_id(ctx, recurring_id);
  if (!item) throw new NotFoundError(kind === "outflow" ? "Bill" : "Income", recurring_id);
  if (item.user_id === caller_id) return { owner_id: item.user_id, via_group_id: null };

  // Not the owner: the item's account must be placed in a group both are members of.
  const accounts = await account_repo.get_by_user_id(ctx, item.user_id);
  const account = accounts.find(
    (a) => a.account_id === item.account_id || a.id === item.account_id
  );
  const group_id = account?.placement?.group_id ?? null;
  if (!group_id) throw new PermissionDeniedError("open", `${kind} ${recurring_id}`);
  const group = await group_repo.get(ctx, group_id);
  if (!is_member(group, caller_id) || !is_member(group, item.user_id)) {
    throw new PermissionDeniedError("open", `${kind} ${recurring_id}`);
  }
  return { owner_id: item.user_id, via_group_id: group_id };
}

/** What `get_recurring_detail` needs: the period, its bill / income, and the caller's access. */
export interface RecurringDetailDeps {
  period: Record<string, unknown>;
  recurring_id: string;
  definition: Record<string, unknown>;
  access: RecurringAccess;
}

export async function resolve_recurring_detail_deps(
  ctx: TraceContext,
  caller_id: string,
  kind: RecurringNoteKind,
  period_id: string
): Promise<RecurringDetailDeps> {
  const period = await recurring_note_repo.get_period_raw(ctx, kind, period_id);
  const recurring_id = period ? period_recurring_id(kind, period) : null;
  if (!period || !recurring_id) {
    throw new NotFoundError(kind === "outflow" ? "Bill period" : "Income period", period_id);
  }
  const access = await resolve_recurring_access(ctx, caller_id, kind, recurring_id);
  const definition = await recurring_note_repo.get_definition_raw(ctx, kind, recurring_id);
  if (!definition) throw new NotFoundError(kind === "outflow" ? "Bill" : "Income", recurring_id);
  return { period, recurring_id, definition, access };
}

/** What `set_recurring_note` needs: access, plus the period when the note is on one. */
export async function resolve_recurring_note_deps(
  ctx: TraceContext,
  caller_id: string,
  kind: RecurringNoteKind,
  recurring_id: string,
  period_id: string | null
): Promise<{ access: RecurringAccess; period: Record<string, unknown> | null }> {
  const access = await resolve_recurring_access(ctx, caller_id, kind, recurring_id);
  const period = period_id ? await recurring_note_repo.get_period_raw(ctx, kind, period_id) : null;
  if (period_id && !period) {
    throw new NotFoundError(kind === "outflow" ? "Bill period" : "Income period", period_id);
  }
  return { access, period };
}
