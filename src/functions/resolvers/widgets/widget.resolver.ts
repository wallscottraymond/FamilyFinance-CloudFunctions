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

/** The account's stored widget token (encrypted), or null. */
export async function resolve_stored_widget_token(
  user_id: string
): Promise<StoredWidgetToken | null> {
  return widget_token_repo.get_for_user(user_id);
}
