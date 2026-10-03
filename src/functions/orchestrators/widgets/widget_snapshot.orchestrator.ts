/**
 * Widget Snapshot Orchestrator ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Serves the iOS widget's self-fetch (every ~30 min, app closed):
 *   1. token → sha256 → user + current data version (2 reads)
 *   2. widget already has this version → "unchanged" (done; ~2 reads total)
 *   3. else current source period for the cadence → derive_period (same window the app uses,
 *      so it shares the derived-period cache) → pure snapshot (same math as the Home card).
 *
 * Read-only. Never writes.
 *
 * @module orchestrators/widgets/widget_snapshot
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  resolve_widget_request,
  resolve_current_source_period,
} from "../../resolvers/widgets/widget.resolver";
import {
  build_widget_snapshot,
  WidgetSnapshotPayload,
} from "../../domain/widgets/widget_snapshot.service";
import { derive_period_orchestrator } from "../periods/derive_period.orchestrator";
import { hash_widget_token } from "../../domain/widgets/widget_token.service";

export interface WidgetSnapshotInput {
  /** Raw bearer token from the widget (hashed here; never stored or logged). */
  token: string;
  cadence: "monthly" | "weekly" | "bi_monthly";
  /** The data version the widget already has (skip work when unchanged). */
  have_version: number | null;
  now_ms: number;
}

export type WidgetSnapshotOutcome =
  | { status: "unauthorized" }
  | { status: "unchanged"; version: number }
  | { status: "no_period"; version: number }
  | { status: "snapshot"; version: number; snapshot: WidgetSnapshotPayload };

export async function widget_snapshot_orchestrator(
  ctx: TraceContext,
  input: WidgetSnapshotInput
): Promise<WidgetSnapshotOutcome> {
  const span = create_span(ctx, "orchestrator", "widget_snapshot");
  log_operation_start(span, "widget");
  try {
    const request = await resolve_widget_request(hash_widget_token(input.token));
    if (!request) {
      log_operation_success(span, "widget");
      return { status: "unauthorized" };
    }
    const { user_id, data_version } = request;

    if (input.have_version !== null && input.have_version === data_version) {
      log_operation_success(span, user_id);
      return { status: "unchanged", version: data_version };
    }

    const period = await resolve_current_source_period(ctx, input.cadence, input.now_ms);
    if (!period) {
      log_operation_success(span, user_id);
      return { status: "no_period", version: data_version };
    }

    const start_ms = period.start_date.toMillis();
    const end_ms = period.end_date.toMillis();
    const derived = await derive_period_orchestrator(ctx, user_id, {
      view_cadence: input.cadence,
      window_start_ms: start_ms,
      window_end_ms: end_ms,
    });

    const snapshot = build_widget_snapshot({
      cadence: input.cadence,
      period_id: period.period_id,
      start_ms,
      end_ms,
      budgets: derived.budgets,
      now_ms: input.now_ms,
    });
    log_operation_success(span, user_id);
    return { status: "snapshot", version: data_version, snapshot };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
      user_id: "widget",
    });
    throw error;
  }
}
