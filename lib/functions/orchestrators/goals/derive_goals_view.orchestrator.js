"use strict";
/**
 * Derive Goals View Orchestrator — Goals (Phase 1)
 *
 * Read-only. Resolves a viewed period's bounds, measures every active goal for
 * that period (balance snapshots + priority partition), and returns a camelCase
 * DTO for the period-page Goals section. Writes nothing.
 *
 * @module orchestrators/goals/derive_goals_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_goals_view_orchestrator = derive_goals_view_orchestrator;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const goal_measurement_resolver_1 = require("../../resolvers/goals/goal_measurement.resolver");
const goals_view_service_1 = require("../../domain/goals/goals_view.service");
async function derive_goals_view_orchestrator(ctx, user_id, period_id) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_goals_view");
    (0, observability_1.log_operation_start)(span, user_id);
    const period = await source_period_repo_1.source_period_repo.get_by_id(ctx, period_id);
    if (!period) {
        throw new errors_1.NotFoundError("source_period", period_id);
    }
    const views = await (0, goal_measurement_resolver_1.resolve_goal_measurements)(ctx, user_id, period_id, period.start_date, period.end_date);
    const result = (0, goals_view_service_1.build_goals_view)(period_id, views);
    (0, observability_1.log_operation_success)(span, user_id);
    return result;
}
//# sourceMappingURL=derive_goals_view.orchestrator.js.map