/**
 * User Summary Resolver
 *
 * Resolves dependencies needed for user period summary computation.
 * Fetches all resource periods (outflows, budgets, inflows) for a given period.
 *
 * READ-ONLY: No business logic, no mutations.
 *
 * @module resolvers/summaries/user_summary
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext, DependencyResult, no_dependencies } from "../../types";
import {
  OutflowPeriod,
  BudgetPeriodDocument,
  InflowPeriod,
  SourcePeriod,
} from "../../../types";

/**
 * Input for resolving user summary dependencies.
 */
export interface ResolveUserSummaryInput {
  user_id: string;
  period_type: string;
  source_period_id: string;
}

/**
 * Dependencies resolved for user summary computation.
 */
export interface UserSummaryDependencies {
  source_period: SourcePeriod;
  outflow_periods: OutflowPeriod[];
  budget_periods: BudgetPeriodDocument[];
  inflow_periods: InflowPeriod[];
  dependency_result: DependencyResult;
}

/**
 * Resolve dependencies for user period summary computation.
 *
 * Fetches:
 * 1. The source period document
 * 2. All outflow_periods for the user and period
 * 3. All budget_periods for the user and period
 * 4. All inflow_periods for the user and period
 *
 * READ-ONLY: Only queries data, no mutations.
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with user, period type, and source period
 * @returns Dependencies needed for summary computation
 */
export async function resolve_user_summary_dependencies(
  ctx: TraceContext,
  input: ResolveUserSummaryInput
): Promise<UserSummaryDependencies> {
  const { user_id, period_type, source_period_id } = input;

  console.log(
    `[${ctx.trace_id}] resolve_user_summary_dependencies: ` +
      `user=${user_id}, period=${source_period_id}, type=${period_type}`
  );

  const db = getFirestore();

  // 1. Fetch source period
  const source_period_doc = await db
    .collection("source_periods")
    .doc(source_period_id)
    .get();

  if (!source_period_doc.exists) {
    throw new Error(`Source period not found: ${source_period_id}`);
  }

  const source_period = source_period_doc.data() as SourcePeriod;

  console.log(
    `[${ctx.trace_id}] resolve_user_summary_dependencies: found source period ` +
      `type=${source_period.type}, year=${source_period.year}`
  );

  // 2. Fetch all resource periods in parallel
  /* eslint-disable @typescript-eslint/naming-convention */
  const [outflow_snapshot, budget_snapshot, inflow_snapshot] = await Promise.all([
    // Outflow periods
    db
      .collection("outflow_periods")
      .where("ownerId", "==", user_id)
      .where("sourcePeriodId", "==", source_period_id)
      .where("isActive", "==", true)
      .get(),

    // Budget periods
    db
      .collection("budget_periods")
      .where("userId", "==", user_id)
      .where("sourcePeriodId", "==", source_period_id)
      .where("periodType", "==", period_type)
      .where("isActive", "==", true)
      .get(),

    // Inflow periods
    db
      .collection("inflow_periods")
      .where("ownerId", "==", user_id)
      .where("sourcePeriodId", "==", source_period_id)
      .where("isActive", "==", true)
      .get(),
  ]);
  /* eslint-enable @typescript-eslint/naming-convention */

  // 3. Map snapshots to typed arrays
  const outflow_periods = outflow_snapshot.docs.map(
    (doc) => doc.data() as OutflowPeriod
  );
  const budget_periods = budget_snapshot.docs.map(
    (doc) => doc.data() as BudgetPeriodDocument
  );
  const inflow_periods = inflow_snapshot.docs.map(
    (doc) => doc.data() as InflowPeriod
  );

  console.log(
    `[${ctx.trace_id}] resolve_user_summary_dependencies: found resources - ` +
      `outflows=${outflow_periods.length}, ` +
      `budgets=${budget_periods.length}, ` +
      `inflows=${inflow_periods.length}`
  );

  // 4. Return dependencies
  return {
    source_period,
    outflow_periods,
    budget_periods,
    inflow_periods,
    dependency_result: no_dependencies(), // Summary computation doesn't affect other entities
  };
}

/**
 * Batch resolve dependencies for multiple periods.
 *
 * Efficiently fetches dependencies for multiple source periods at once.
 * Used when updating summaries for multiple periods (e.g., after outflow creation).
 *
 * @param ctx - Trace context for logging
 * @param user_id - The user ID
 * @param period_type - The period type
 * @param source_period_ids - Array of source period IDs
 * @returns Map of source_period_id to dependencies
 */
export async function batch_resolve_user_summary_dependencies(
  ctx: TraceContext,
  user_id: string,
  period_type: string,
  source_period_ids: string[]
): Promise<Map<string, UserSummaryDependencies>> {
  console.log(
    `[${ctx.trace_id}] batch_resolve_user_summary_dependencies: ` +
      `user=${user_id}, type=${period_type}, periods=${source_period_ids.length}`
  );

  const results = new Map<string, UserSummaryDependencies>();

  // Process each period (could be optimized with IN queries if needed)
  await Promise.all(
    source_period_ids.map(async (source_period_id) => {
      try {
        const deps = await resolve_user_summary_dependencies(ctx, {
          user_id,
          period_type,
          source_period_id,
        });
        results.set(source_period_id, deps);
      } catch (error) {
        console.error(
          `[${ctx.trace_id}] batch_resolve_user_summary_dependencies: ` +
            `error for period ${source_period_id}:`,
          error
        );
        // Skip failed periods rather than failing the entire batch
      }
    })
  );

  console.log(
    `[${ctx.trace_id}] batch_resolve_user_summary_dependencies: ` +
      `resolved ${results.size}/${source_period_ids.length} periods`
  );

  return results;
}
