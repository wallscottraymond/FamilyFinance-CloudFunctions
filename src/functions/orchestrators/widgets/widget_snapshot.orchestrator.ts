/**
 * Widget Snapshot Orchestrator ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * Serves the iOS widgets' self-fetch (every ~30 min with the app closed, or immediately when
 * the running app asks WidgetKit to reload). The backend is the single source of widget data:
 *   1. token → sha256 → user; then the view version (Me or group — membership checked: not a
 *      member → "not_member"), combined with the UTC day into the widget's version
 *   2. widget already has this version → "unchanged" (done). The day is part of it because the
 *      payload is day-relative (current period, `overdue`): a widget refetches once per UTC day
 *   3. else only the derives this widget KIND needs (same windows the app derives, so they
 *      share the derived-period cache) → pure builders that mirror the app's formulas.
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
  resolve_source_periods_from_now,
} from "../../resolvers/widgets/widget.resolver";
import {
  WIDGET_DATA_VERSION,
  WidgetData,
  compute_left_to_spend,
  compute_period_summary,
  compute_bills_due_soon,
  compute_budget_lines,
  compute_recent_budget_transactions,
  short_period_label,
} from "../../domain/widgets/widget_snapshot.service";
import { hash_widget_token } from "../../domain/widgets/widget_token.service";
import { derive_period_orchestrator } from "../periods/derive_period.orchestrator";
import { derive_goals_view_orchestrator } from "../goals/derive_goals_view.orchestrator";
import {
  derive_budget_transactions_orchestrator,
} from "../budgets/derive_budget_transactions.orchestrator";
import { SourcePeriodEntity } from "../../repositories/source_period.repo";
import { group_repo } from "../../repositories/sharing";
import { is_member } from "../../domain/sharing/group.service";
import {
  DeriveScopeRequest,
  widget_view_version,
} from "../../domain/periods/derive_scope.service";
import { resolve_view_version } from "../../resolvers/periods/view_version.resolver";

export type WidgetCadence = "monthly" | "weekly" | "bi_monthly";

export interface WidgetSnapshotInput {
  /** Raw bearer token from the widget (hashed here; never stored or logged). */
  token: string;
  kind: "left" | "summary" | "bills" | "budget_txns";
  /** kind=budget_txns: the budget whose recent transactions to return. */
  budget_id: string | null;
  cadence: WidgetCadence;
  lookahead_days: number;
  /** Account-Rooted-Sharing: the group this widget shows (Edit Widget → Show); null = Me. */
  group_id: string | null;
  /** The data version the widget already has (skip work when unchanged). */
  have_version: number | null;
  now_ms: number;
}

export type WidgetSnapshotOutcome =
  | { status: "unauthorized" }
  | { status: "not_member" }
  | { status: "unchanged"; version: number }
  | { status: "no_period"; version: number }
  | { status: "data"; version: number; data: WidgetData };

async function derive_for(
  ctx: TraceContext,
  user_id: string,
  period: SourcePeriodEntity,
  cadence: WidgetCadence,
  scope: DeriveScopeRequest | undefined
) {
  return derive_period_orchestrator(ctx, user_id, {
    view_cadence: cadence,
    window_start_ms: period.start_date.toMillis(),
    window_end_ms: period.end_date.toMillis(),
    scope,
  });
}

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
    const { user_id } = request;

    // A group widget: the caller must still be a member; its "unchanged" check uses the group
    // view's version (moves when any member's data or the group's budgets change).
    let scope: DeriveScopeRequest | undefined;
    let group_name: string | undefined;
    if (input.group_id) {
      const group = await group_repo.get(ctx, input.group_id);
      if (!is_member(group, user_id)) {
        log_operation_success(span, user_id);
        return { status: "not_member" };
      }
      scope = { kind: "group", group_id: input.group_id };
      group_name = group!.name;
    }
    const version = widget_view_version(
      (await resolve_view_version(ctx, user_id, scope)).version,
      input.now_ms
    );
    if (input.have_version !== null && input.have_version === version) {
      log_operation_success(span, user_id);
      return { status: "unchanged", version };
    }

    // Bills are date-based (cadence-independent): current + next MONTH covers any look-ahead.
    const cadence: WidgetCadence = input.kind === "bills" ? "monthly" : input.cadence;
    const periods = await resolve_source_periods_from_now(
      ctx,
      cadence,
      input.now_ms,
      input.kind === "bills" ? 2 : 1
    );
    const current = periods[0];
    if (!current) {
      log_operation_success(span, user_id);
      return { status: "no_period", version };
    }
    const label = short_period_label(
      cadence,
      current.start_date.toMillis(),
      current.end_date.toMillis()
    );

    // Widget payloads are a camelCase wire format (see the domain service).
    /* eslint-disable @typescript-eslint/naming-convention */
    let data: WidgetData;
    if (input.kind === "left") {
      const derived = await derive_for(ctx, user_id, current, cadence, scope);
      data = {
        v: WIDGET_DATA_VERSION,
        kind: "left",
        asOfMs: input.now_ms,
        cadence,
        periodLabel: label,
        startMs: current.start_date.toMillis(),
        endMs: current.end_date.toMillis(),
        leftToSpend: compute_left_to_spend(derived.budgets, current.period_id, true),
        leftToSpendRealOnly: compute_left_to_spend(derived.budgets, current.period_id, false),
        budgets: compute_budget_lines(derived.budgets, current.period_id),
      };
    } else if (input.kind === "budget_txns") {
      // Same rows as the app's Budget Detail list for this period (cached per budget+window).
      const rows = await derive_budget_transactions_orchestrator(
        ctx,
        user_id,
        input.budget_id ?? "",
        current.start_date.toMillis(),
        current.end_date.toMillis(),
        false,
        scope
      );
      data = {
        v: WIDGET_DATA_VERSION,
        kind: "budget_txns",
        asOfMs: input.now_ms,
        budgetId: input.budget_id ?? "",
        transactions: compute_recent_budget_transactions(rows),
      };
    } else if (input.kind === "summary") {
      const [derived, goals] = await Promise.all([
        derive_for(ctx, user_id, current, cadence, scope),
        derive_goals_view_orchestrator(ctx, user_id, current.period_id, scope),
      ]);
      data = {
        v: WIDGET_DATA_VERSION,
        kind: "summary",
        asOfMs: input.now_ms,
        cadence,
        periodLabel: label,
        summary: compute_period_summary(derived, current.period_id, goals.goals),
      };
    } else {
      const derives = await Promise.all(
        periods.map((p) => derive_for(ctx, user_id, p, cadence, scope))
      );
      const due = compute_bills_due_soon(
        periods.map((p, i) => ({ period_id: p.period_id, bills: derives[i].bills })),
        input.now_ms,
        input.lookahead_days
      );
      data = {
        v: WIDGET_DATA_VERSION,
        kind: "bills",
        asOfMs: input.now_ms,
        lookaheadDays: input.lookahead_days,
        items: due.items,
        moreCount: due.moreCount,
      };
    }
    if (group_name !== undefined) data = { ...data, groupName: group_name };
    /* eslint-enable @typescript-eslint/naming-convention */
    log_operation_success(span, user_id);
    return { status: "data", version, data };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
      user_id: "widget",
    });
    throw error;
  }
}
