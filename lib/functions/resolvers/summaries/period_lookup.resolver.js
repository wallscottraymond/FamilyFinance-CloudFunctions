"use strict";
/**
 * Period Lookup Resolver
 *
 * Resolves period documents by IDs for summary updates and groups them by
 * (period_type → source_period_ids) for recompute fan-out.
 * READ-ONLY: No business logic, no mutations. All reads go through repositories.
 *
 * @module resolvers/summaries/period_lookup
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_outflow_periods_for_summary = resolve_outflow_periods_for_summary;
exports.resolve_inflow_periods_for_summary = resolve_inflow_periods_for_summary;
exports.resolve_budget_periods_for_summary = resolve_budget_periods_for_summary;
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
/**
 * Group raw period docs (id + data) by period type and source period.
 * Pure helper shared by all three period kinds.
 */
function group_periods(period_docs) {
    const periods_by_type = new Map();
    for (const { data: period } of period_docs) {
        const period_type = String(period.periodType).toLowerCase();
        const source_period_id = period.sourcePeriodId;
        if (!periods_by_type.has(period_type)) {
            periods_by_type.set(period_type, new Set());
        }
        periods_by_type.get(period_type).add(source_period_id);
    }
    return { periods_by_type };
}
/**
 * Resolve outflow period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of outflow_period document IDs
 * @returns Grouped periods by type
 */
async function resolve_outflow_periods_for_summary(ctx, period_ids) {
    const period_docs = await outflow_period_repo_1.outflow_period_repo.get_by_ids(ctx, period_ids);
    return group_periods(period_docs);
}
/**
 * Resolve inflow period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of inflow_period document IDs
 * @returns Grouped periods by type
 */
async function resolve_inflow_periods_for_summary(ctx, period_ids) {
    const period_docs = await inflow_period_repo_1.inflow_period_repo.get_by_ids(ctx, period_ids);
    return group_periods(period_docs);
}
/**
 * Resolve budget period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of budget_period document IDs
 * @returns Grouped periods by type
 */
async function resolve_budget_periods_for_summary(ctx, period_ids) {
    const period_docs = await budget_period_repo_1.budget_period_repo.get_by_ids(ctx, period_ids);
    return group_periods(period_docs);
}
//# sourceMappingURL=period_lookup.resolver.js.map