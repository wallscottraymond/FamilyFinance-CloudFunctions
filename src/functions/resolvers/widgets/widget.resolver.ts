/**
 * Widget Resolver ([[iOS-Home-Screen-Widgets]] Phase 2) — READ-ONLY lookups for the widget
 * endpoint and token callable.
 *
 * @module resolvers/widgets/widget
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { widget_token_repo, StoredWidgetToken } from "../../repositories/widget_token.repo";
import { get_derive_version } from "../../repositories/derive_version.repo";
import {
  source_period_repo,
  SourcePeriodEntity,
} from "../../repositories/source_period.repo";

/** Owner of a widget token hash (null = unknown/revoked) + their current data version. */
export async function resolve_widget_request(
  token_hash: string
): Promise<{ user_id: string; data_version: number } | null> {
  const user_id = await widget_token_repo.get_user_by_hash(token_hash);
  if (!user_id) return null;
  const data_version = await get_derive_version(user_id);
  return { user_id, data_version };
}

/** The source period of `cadence` containing `now_ms` (null if none generated). */
export async function resolve_current_source_period(
  ctx: TraceContext,
  cadence: string,
  now_ms: number
): Promise<SourcePeriodEntity | null> {
  const now = Timestamp.fromMillis(now_ms);
  const periods = await source_period_repo.get_overlapping(ctx, now, now);
  return (
    periods.find(
      (p) =>
        p.period_type === cadence &&
        p.start_date.toMillis() <= now_ms &&
        p.end_date.toMillis() >= now_ms
    ) ?? null
  );
}

/** The account's stored widget token (encrypted), or null. */
export async function resolve_stored_widget_token(
  user_id: string
): Promise<StoredWidgetToken | null> {
  return widget_token_repo.get_for_user(user_id);
}
