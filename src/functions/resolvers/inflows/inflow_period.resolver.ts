/**
 * Inflow Period Resolver
 *
 * Resolves dependencies needed for inflow period generation.
 * Fetches source periods and inflow data.
 *
 * @module resolvers/inflows/inflow_period
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext, DependencyResult, no_dependencies } from "../../types";
import { inflow_repo, Inflow, source_period_repo } from "../../repositories";
import {
  InflowForPeriodGeneration,
  SourcePeriodForGeneration,
} from "../../domain/inflows";

/**
 * Input for resolving inflow period dependencies.
 */
export interface ResolveInflowPeriodInput {
  inflow_id: string;
  user_id: string;
  /** Start date for period generation (defaults to inflow first_date) */
  start_date?: Date;
  /** End date for period generation (defaults to 12 months forward) */
  end_date?: Date;
}

/**
 * Dependencies resolved for inflow period generation.
 */
export interface InflowPeriodDependencies {
  inflow: InflowForPeriodGeneration;
  source_periods: SourcePeriodForGeneration[];
  dependency_result: DependencyResult;
}

/**
 * Maps inflow entity from repo to domain format.
 */
function map_inflow_to_domain(inflow: Inflow): InflowForPeriodGeneration {
  return {
    id: inflow.id,
    owner_id: inflow.user_id,
    created_by: inflow.user_id, // Simplified - repo doesn't track created_by
    group_id: inflow.group_ids[0] ?? null,
    group_ids: inflow.group_ids,
    plaid_item_id: inflow.plaid_item_id,
    account_id: inflow.account_id,
    average_amount: inflow.average_amount,
    currency: inflow.currency,
    description: inflow.description,
    payer_name: inflow.payer_name,
    user_custom_name: inflow.user_custom_name,
    frequency: inflow.frequency,
    first_date: inflow.first_date,
    last_date: inflow.last_date,
    predicted_next_date: inflow.predicted_next_date,
    plaid_primary_category: inflow.plaid_primary_category,
    plaid_detailed_category: inflow.plaid_detailed_category,
    internal_primary_category: inflow.internal_primary_category,
    internal_detailed_category: inflow.internal_detailed_category,
    income_type: inflow.income_type,
    is_active: inflow.is_active,
    is_hidden: inflow.is_hidden,
    source: inflow.source,
    tags: inflow.tags,
    rules: inflow.rules,
    transaction_ids: inflow.transaction_ids,
  };
}

/**
 * Resolve dependencies for inflow period generation.
 *
 * Fetches:
 * 1. The inflow document
 * 2. Source periods within the date range
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with inflow ID and date range
 * @returns Dependencies needed for period generation
 */
export async function resolve_inflow_period_dependencies(
  ctx: TraceContext,
  input: ResolveInflowPeriodInput
): Promise<InflowPeriodDependencies> {
  console.log(
    `[${ctx.trace_id}] resolve_inflow_period_dependencies: inflow_id=${input.inflow_id}`
  );

  // 1. Get the inflow document
  const inflow = await inflow_repo.get_by_id(ctx, input.inflow_id);

  if (!inflow) {
    throw new Error(`Inflow not found: ${input.inflow_id}`);
  }

  if (!inflow.is_active) {
    throw new Error(`Inflow is not active: ${input.inflow_id}`);
  }

  // 2. Calculate date range for period generation
  const start_date = input.start_date ?? inflow.first_date.toDate();
  const end_date = input.end_date ?? new Date();
  if (!input.end_date) {
    end_date.setMonth(end_date.getMonth() + 12); // 12 months forward
  }

  console.log(
    `[${ctx.trace_id}] resolve_inflow_period_dependencies: date range ` +
    `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`
  );

  // 3. Query source periods within the date range
  const periods = await source_period_repo.get_by_start_date_range(
    ctx,
    Timestamp.fromDate(start_date),
    Timestamp.fromDate(end_date)
  );
  const source_periods: SourcePeriodForGeneration[] = periods.map((p) => ({
    id: p.id,
    period_id: p.period_id,
    type: p.period_type,
    start_date: p.start_date,
    end_date: p.end_date,
  }));

  console.log(
    `[${ctx.trace_id}] resolve_inflow_period_dependencies: found ${source_periods.length} source periods`
  );

  // 4. Return dependencies
  return {
    inflow: map_inflow_to_domain(inflow),
    source_periods,
    dependency_result: no_dependencies(), // Period generation doesn't affect other entities
  };
}

/**
 * Resolve inflow directly from Firestore document data.
 *
 * Used by triggers that have the document data already.
 * Avoids an extra read.
 *
 * @param ctx - Trace context
 * @param inflow_id - Inflow document ID
 * @param inflow_data - Raw Firestore document data (camelCase)
 * @param options - Optional date range overrides
 */
export async function resolve_inflow_period_dependencies_from_doc(
  ctx: TraceContext,
  inflow_id: string,
  inflow_data: Record<string, unknown>,
  options?: { start_date?: Date; end_date?: Date }
): Promise<InflowPeriodDependencies> {
  console.log(
    `[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: inflow_id=${inflow_id}`
  );

  // Map camelCase Firestore doc to snake_case domain format
  /* eslint-disable @typescript-eslint/naming-convention */
  const first_date = inflow_data.firstDate as Timestamp;
  const last_date = inflow_data.lastDate as Timestamp;
  const predicted_next_date = inflow_data.predictedNextDate as Timestamp | null;

  const inflow: InflowForPeriodGeneration = {
    id: inflow_id,
    owner_id: (inflow_data.ownerId as string) ?? (inflow_data.userId as string),
    created_by: (inflow_data.createdBy as string) ?? (inflow_data.ownerId as string),
    group_id: (inflow_data.groupId as string) ?? null,
    group_ids: (inflow_data.groupIds as string[]) ??
      (inflow_data.groupId ? [inflow_data.groupId as string] : []),
    plaid_item_id: inflow_data.plaidItemId as string,
    account_id: inflow_data.accountId as string,
    average_amount: inflow_data.averageAmount as number,
    currency: (inflow_data.currency as string) ?? "USD",
    description: (inflow_data.description as string) ?? null,
    payer_name: (inflow_data.merchantName as string) ?? (inflow_data.payerName as string) ?? null,
    user_custom_name: (inflow_data.userCustomName as string) ?? null,
    frequency: inflow_data.frequency as string,
    first_date,
    last_date,
    predicted_next_date,
    plaid_primary_category: (inflow_data.plaidPrimaryCategory as string) ?? "INCOME",
    plaid_detailed_category: (inflow_data.plaidDetailedCategory as string) ?? "",
    internal_primary_category: (inflow_data.internalPrimaryCategory as string) ?? null,
    internal_detailed_category: (inflow_data.internalDetailedCategory as string) ?? null,
    income_type: (inflow_data.incomeType as string) ?? "other",
    is_active: (inflow_data.isActive as boolean) ?? true,
    is_hidden: (inflow_data.isHidden as boolean) ?? false,
    source: (inflow_data.source as string) ?? "plaid",
    tags: (inflow_data.tags as string[]) ?? [],
    rules: (inflow_data.rules as unknown[]) ?? [],
    transaction_ids: (inflow_data.transactionIds as string[]) ?? [],
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  // Check if active
  if (!inflow.is_active) {
    throw new Error(`Inflow is not active: ${inflow_id}`);
  }

  // Calculate date range
  const start_date = options?.start_date ?? first_date.toDate();
  const end_date = options?.end_date ?? new Date();
  if (!options?.end_date) {
    end_date.setMonth(end_date.getMonth() + 12);
  }

  console.log(
    `[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: date range ` +
    `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`
  );

  // Query source periods
  const periods = await source_period_repo.get_by_start_date_range(
    ctx,
    Timestamp.fromDate(start_date),
    Timestamp.fromDate(end_date)
  );
  const source_periods: SourcePeriodForGeneration[] = periods.map((p) => ({
    id: p.id,
    period_id: p.period_id,
    type: p.period_type,
    start_date: p.start_date,
    end_date: p.end_date,
  }));

  console.log(
    `[${ctx.trace_id}] resolve_inflow_period_dependencies_from_doc: found ${source_periods.length} source periods`
  );

  return {
    inflow,
    source_periods,
    dependency_result: no_dependencies(),
  };
}
