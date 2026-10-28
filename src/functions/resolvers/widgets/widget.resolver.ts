/**
 * Widget Resolver ([[iOS-Home-Screen-Widgets]] Phase 2) — READ-ONLY lookups for the widget
 * endpoint and token callable.
 *
 * @module resolvers/widgets/widget
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { widget_token_repo, StoredWidgetToken } from "../../repositories/widget_token.repo";
import {
  source_period_repo,
  SourcePeriodEntity,
} from "../../repositories/source_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { outflow_repo } from "../../repositories/outflow.repo";
import { resolve_derive_scope } from "../periods/derive_scope.resolver";
import {
  DeriveScopeRequest,
  transaction_in_scope,
} from "../../domain/periods/derive_scope.service";

/** Owner of a widget token hash (null = unknown/revoked). The view version is resolved by the
 *  caller (`resolve_view_version`), which knows whether this is a Me or a group widget. */
export async function resolve_widget_request(
  token_hash: string
): Promise<{ user_id: string } | null> {
  const user_id = await widget_token_repo.get_user_by_hash(token_hash);
  if (!user_id) return null;
  return { user_id };
}

/**
 * The `cadence` source periods from the one containing `now_ms` onward, soonest first
 * (`count` of them: 1 = current; 2 = current + next, for "bills due soon").
 */
export async function resolve_source_periods_from_now(
  ctx: TraceContext,
  cadence: string,
  now_ms: number,
  count: number
): Promise<SourcePeriodEntity[]> {
  const lookahead_ms = count > 1 ? 45 * 24 * 60 * 60 * 1000 : 0; // covers the next month
  const periods = await source_period_repo.get_overlapping(
    ctx,
    Timestamp.fromMillis(now_ms),
    Timestamp.fromMillis(now_ms + lookahead_ms)
  );
  return periods
    .filter((p) => p.period_type === cadence && p.end_date.toMillis() >= now_ms)
    .sort((a, b) => a.start_date.toMillis() - b.start_date.toMillis())
    .slice(0, count);
}

/** How many of each member's newest transactions the Recent widget reads (the app's Home card
 *  reads up to 100 too: a day of many own-account transfers must not starve the list). */
const RECENT_READ_LIMIT = 100;

/**
 * The view's newest transactions (Me or a group), newest first: each member's latest
 * RECENT_READ_LIMIT, kept only when they belong to the view (`transaction_in_scope`). Raw docs;
 * which rows show is the domain's call (`select_recent_transactions`). READ-ONLY.
 */
export async function resolve_recent_view_transactions(
  ctx: TraceContext,
  user_id: string,
  scope_request: DeriveScopeRequest | undefined
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const scope = await resolve_derive_scope(ctx, user_id, scope_request);
  const per_member = await Promise.all(
    scope.member_ids.map((m) => transaction_repo.get_latest_by_owner(ctx, m, RECENT_READ_LIMIT))
  );
  return per_member.flat().filter((t) => {
    const date = t.data.transactionDate as Timestamp | undefined;
    const account_id = t.data.accountId as string | undefined;
    return transaction_in_scope(scope, account_id, date?.toMillis?.() ?? 0);
  });
}

/** The bills (outflows) the shown rows paid, by id (names): ONE batched read. READ-ONLY. */
export async function resolve_bill_names(
  ctx: TraceContext,
  outflow_ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  if (outflow_ids.length === 0) return new Map();
  return outflow_repo.get_raw_by_ids(ctx, outflow_ids);
}

/** The account's stored widget token (encrypted), or null. */
export async function resolve_stored_widget_token(
  user_id: string
): Promise<StoredWidgetToken | null> {
  return widget_token_repo.get_for_user(user_id);
}
