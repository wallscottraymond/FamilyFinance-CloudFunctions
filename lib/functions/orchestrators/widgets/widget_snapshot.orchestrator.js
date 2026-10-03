"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.widget_snapshot_orchestrator = widget_snapshot_orchestrator;
const observability_1 = require("../../observability");
const widget_resolver_1 = require("../../resolvers/widgets/widget.resolver");
const widget_snapshot_service_1 = require("../../domain/widgets/widget_snapshot.service");
const derive_period_orchestrator_1 = require("../periods/derive_period.orchestrator");
const widget_token_service_1 = require("../../domain/widgets/widget_token.service");
async function widget_snapshot_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "widget_snapshot");
    (0, observability_1.log_operation_start)(span, "widget");
    try {
        const request = await (0, widget_resolver_1.resolve_widget_request)((0, widget_token_service_1.hash_widget_token)(input.token));
        if (!request) {
            (0, observability_1.log_operation_success)(span, "widget");
            return { status: "unauthorized" };
        }
        const { user_id, data_version } = request;
        if (input.have_version !== null && input.have_version === data_version) {
            (0, observability_1.log_operation_success)(span, user_id);
            return { status: "unchanged", version: data_version };
        }
        const period = await (0, widget_resolver_1.resolve_current_source_period)(ctx, input.cadence, input.now_ms);
        if (!period) {
            (0, observability_1.log_operation_success)(span, user_id);
            return { status: "no_period", version: data_version };
        }
        const start_ms = period.start_date.toMillis();
        const end_ms = period.end_date.toMillis();
        const derived = await (0, derive_period_orchestrator_1.derive_period_orchestrator)(ctx, user_id, {
            view_cadence: input.cadence,
            window_start_ms: start_ms,
            window_end_ms: end_ms,
        });
        const snapshot = (0, widget_snapshot_service_1.build_widget_snapshot)({
            cadence: input.cadence,
            period_id: period.period_id,
            start_ms,
            end_ms,
            budgets: derived.budgets,
            now_ms: input.now_ms,
        });
        (0, observability_1.log_operation_success)(span, user_id);
        return { status: "snapshot", version: data_version, snapshot };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id: "widget",
        });
        throw error;
    }
}
//# sourceMappingURL=widget_snapshot.orchestrator.js.map