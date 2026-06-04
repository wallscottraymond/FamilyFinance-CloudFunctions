/**
 * Period Lookup Resolver
 *
 * Resolves period documents by IDs for summary updates and groups them by
 * (period_type → source_period_ids) for recompute fan-out.
 * READ-ONLY: No business logic, no mutations. All reads go through repositories.
 *
 * @module resolvers/summaries/period_lookup
 */

import { TraceContext } from "../../types";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";

/**
 * Period info extracted for summary grouping.
 */
export interface PeriodInfo {
  id: string;
  period_type: string;
  source_period_id: string;
}

/**
 * Grouped periods by period type.
 */
export interface GroupedPeriods {
  /** Map of period_type -> Set of source_period_ids */
  periods_by_type: Map<string, Set<string>>;
}

/**
 * Group raw period docs (id + data) by period type and source period.
 * Pure helper shared by all three period kinds.
 */
function group_periods(
  period_docs: Array<{ id: string; data: Record<string, unknown> }>
): GroupedPeriods {
  const periods_by_type = new Map<string, Set<string>>();

  for (const { data: period } of period_docs) {
    const period_type = String(period.periodType).toLowerCase();
    const source_period_id = period.sourcePeriodId as string;

    if (!periods_by_type.has(period_type)) {
      periods_by_type.set(period_type, new Set());
    }
    periods_by_type.get(period_type)!.add(source_period_id);
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
export async function resolve_outflow_periods_for_summary(
  ctx: TraceContext,
  period_ids: string[]
): Promise<GroupedPeriods> {
  const period_docs = await outflow_period_repo.get_by_ids(ctx, period_ids);
  return group_periods(period_docs);
}

/**
 * Resolve inflow period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of inflow_period document IDs
 * @returns Grouped periods by type
 */
export async function resolve_inflow_periods_for_summary(
  ctx: TraceContext,
  period_ids: string[]
): Promise<GroupedPeriods> {
  const period_docs = await inflow_period_repo.get_by_ids(ctx, period_ids);
  return group_periods(period_docs);
}

/**
 * Resolve budget period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of budget_period document IDs
 * @returns Grouped periods by type
 */
export async function resolve_budget_periods_for_summary(
  ctx: TraceContext,
  period_ids: string[]
): Promise<GroupedPeriods> {
  const period_docs = await budget_period_repo.get_by_ids(ctx, period_ids);
  return group_periods(period_docs);
}
