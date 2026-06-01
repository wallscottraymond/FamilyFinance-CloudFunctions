/**
 * Period Lookup Resolver
 *
 * Resolves period documents by IDs for summary updates.
 * READ-ONLY: No business logic, no mutations.
 *
 * @module resolvers/summaries/period_lookup
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";

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
 * Resolve outflow period info by document IDs.
 *
 * Fetches period documents and extracts the info needed for summary grouping.
 * READ-ONLY: Only queries data, no mutations.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of outflow_period document IDs
 * @returns Grouped periods by type
 */
export async function resolve_outflow_periods_for_summary(
  ctx: TraceContext,
  period_ids: string[]
): Promise<GroupedPeriods> {
  const db = getFirestore();

  console.log(
    `[${ctx.trace_id}] resolve_outflow_periods_for_summary: ` +
      `fetching ${period_ids.length} outflow periods`
  );

  // Fetch all outflow period documents
  const period_docs = await Promise.all(
    period_ids.map((id) => db.collection("outflow_periods").doc(id).get())
  );

  // Group by period type and source period
  const periods_by_type = new Map<string, Set<string>>();

  for (const doc of period_docs) {
    if (!doc.exists) continue;

    const period = doc.data()!;
    const period_type = String(period.periodType).toLowerCase();
    const source_period_id = period.sourcePeriodId as string;

    if (!periods_by_type.has(period_type)) {
      periods_by_type.set(period_type, new Set());
    }
    periods_by_type.get(period_type)!.add(source_period_id);
  }

  console.log(
    `[${ctx.trace_id}] resolve_outflow_periods_for_summary: ` +
      `grouped into ${periods_by_type.size} period types`
  );

  return { periods_by_type };
}

/**
 * Resolve inflow period info by document IDs.
 *
 * Fetches period documents and extracts the info needed for summary grouping.
 * READ-ONLY: Only queries data, no mutations.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of inflow_period document IDs
 * @returns Grouped periods by type
 */
export async function resolve_inflow_periods_for_summary(
  ctx: TraceContext,
  period_ids: string[]
): Promise<GroupedPeriods> {
  const db = getFirestore();

  console.log(
    `[${ctx.trace_id}] resolve_inflow_periods_for_summary: ` +
      `fetching ${period_ids.length} inflow periods`
  );

  // Fetch all inflow period documents
  const period_docs = await Promise.all(
    period_ids.map((id) => db.collection("inflow_periods").doc(id).get())
  );

  // Group by period type and source period
  const periods_by_type = new Map<string, Set<string>>();

  for (const doc of period_docs) {
    if (!doc.exists) continue;

    const period = doc.data()!;
    const period_type = String(period.periodType).toLowerCase();
    const source_period_id = period.sourcePeriodId as string;

    if (!periods_by_type.has(period_type)) {
      periods_by_type.set(period_type, new Set());
    }
    periods_by_type.get(period_type)!.add(source_period_id);
  }

  console.log(
    `[${ctx.trace_id}] resolve_inflow_periods_for_summary: ` +
      `grouped into ${periods_by_type.size} period types`
  );

  return { periods_by_type };
}

/**
 * Resolve budget period info by document IDs.
 *
 * Fetches period documents and extracts the info needed for summary grouping.
 * READ-ONLY: Only queries data, no mutations.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of budget_period document IDs
 * @returns Grouped periods by type
 */
export async function resolve_budget_periods_for_summary(
  ctx: TraceContext,
  period_ids: string[]
): Promise<GroupedPeriods> {
  const db = getFirestore();

  console.log(
    `[${ctx.trace_id}] resolve_budget_periods_for_summary: ` +
      `fetching ${period_ids.length} budget periods`
  );

  // Fetch all budget period documents
  const period_docs = await Promise.all(
    period_ids.map((id) => db.collection("budget_periods").doc(id).get())
  );

  // Group by period type and source period
  const periods_by_type = new Map<string, Set<string>>();

  for (const doc of period_docs) {
    if (!doc.exists) continue;

    const period = doc.data()!;
    const period_type = String(period.periodType).toLowerCase();
    const source_period_id = period.sourcePeriodId as string;

    if (!periods_by_type.has(period_type)) {
      periods_by_type.set(period_type, new Set());
    }
    periods_by_type.get(period_type)!.add(source_period_id);
  }

  console.log(
    `[${ctx.trace_id}] resolve_budget_periods_for_summary: ` +
      `grouped into ${periods_by_type.size} period types`
  );

  return { periods_by_type };
}
