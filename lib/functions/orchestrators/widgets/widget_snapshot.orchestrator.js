"use strict";
/**
 * Widget Snapshot Orchestrator ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * Serves the iOS widgets' self-fetch (every ~30 min with the app closed, or immediately when
 * the running app asks WidgetKit to reload). The backend is the single source of widget data:
 *   1. token → sha256 → user + current data version (2 reads)
 *   2. widget already has this version → "unchanged" (done)
 *   3. else only the derives this widget KIND needs (same windows the app derives, so they
 *      share the derived-period cache) → pure builders that mirror the app's formulas.
 *
 * Read-only. Never writes.
 *
 * @module orchestrators/widgets/widget_snapshot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.widget_snapshot_orchestrator = widget_snapshot_orchestrator;
const observability_1 = require("../../observability");
const widget_resolver_1 = require("../../resolvers/widgets/widget.resolver");
const widget_snapshot_service_1 = require("../../domain/widgets/widget_snapshot.service");
const widget_token_service_1 = require("../../domain/widgets/widget_token.service");
const derive_period_orchestrator_1 = require("../periods/derive_period.orchestrator");
const derive_goals_view_orchestrator_1 = require("../goals/derive_goals_view.orchestrator");
async function derive_for(ctx, user_id, period, cadence) {
    return (0, derive_period_orchestrator_1.derive_period_orchestrator)(ctx, user_id, {
        view_cadence: cadence,
        window_start_ms: period.start_date.toMillis(),
        window_end_ms: period.end_date.toMillis(),
    });
}
async function widget_snapshot_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "widget_snapshot");
    (0, observability_1.log_operation_start)(span, "widget");
    try {
        const request = await (0, widget_resolver_1.resolve_widget_request)((0, widget_token_service_1.hash_widget_token)(input.token));
        if (!request) {
            (0, observability_1.log_operation_success)(span, "widget");
            return { status: "unauthorized" };
        }
        const { user_id, data_version: version } = request;
        if (input.have_version !== null && input.have_version === version) {
            (0, observability_1.log_operation_success)(span, user_id);
            return { status: "unchanged", version };
        }
        // Bills are date-based (cadence-independent): current + next MONTH covers any look-ahead.
        const cadence = input.kind === "bills" ? "monthly" : input.cadence;
        const periods = await (0, widget_resolver_1.resolve_source_periods_from_now)(ctx, cadence, input.now_ms, input.kind === "bills" ? 2 : 1);
        const current = periods[0];
        if (!current) {
            (0, observability_1.log_operation_success)(span, user_id);
            return { status: "no_period", version };
        }
        const label = (0, widget_snapshot_service_1.short_period_label)(cadence, current.start_date.toMillis(), current.end_date.toMillis());
        // Widget payloads are a camelCase wire format (see the domain service).
        /* eslint-disable @typescript-eslint/naming-convention */
        let data;
        if (input.kind === "left") {
            const derived = await derive_for(ctx, user_id, current, cadence);
            data = {
                v: widget_snapshot_service_1.WIDGET_DATA_VERSION,
                kind: "left",
                asOfMs: input.now_ms,
                cadence,
                periodLabel: label,
                leftToSpend: (0, widget_snapshot_service_1.compute_left_to_spend)(derived.budgets, current.period_id, true),
                leftToSpendRealOnly: (0, widget_snapshot_service_1.compute_left_to_spend)(derived.budgets, current.period_id, false),
            };
        }
        else if (input.kind === "summary") {
            const [derived, goals] = await Promise.all([
                derive_for(ctx, user_id, current, cadence),
                (0, derive_goals_view_orchestrator_1.derive_goals_view_orchestrator)(ctx, user_id, current.period_id),
            ]);
            data = {
                v: widget_snapshot_service_1.WIDGET_DATA_VERSION,
                kind: "summary",
                asOfMs: input.now_ms,
                cadence,
                periodLabel: label,
                summary: (0, widget_snapshot_service_1.compute_period_summary)(derived, current.period_id, goals.goals),
            };
        }
        else {
            const derives = await Promise.all(periods.map((p) => derive_for(ctx, user_id, p, cadence)));
            const due = (0, widget_snapshot_service_1.compute_bills_due_soon)(periods.map((p, i) => ({ period_id: p.period_id, bills: derives[i].bills })), input.now_ms, input.lookahead_days);
            data = {
                v: widget_snapshot_service_1.WIDGET_DATA_VERSION,
                kind: "bills",
                asOfMs: input.now_ms,
                lookaheadDays: input.lookahead_days,
                items: due.items,
                moreCount: due.moreCount,
            };
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        (0, observability_1.log_operation_success)(span, user_id);
        return { status: "data", version, data };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id: "widget",
        });
        throw error;
    }
}
//# sourceMappingURL=widget_snapshot.orchestrator.js.map