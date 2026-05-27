/**
 * Outflow Period Resolver
 *
 * Resolves dependencies needed for outflow period generation.
 * Fetches source periods and outflow data.
 *
 * @module resolvers/outflows/outflow_period
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext, DependencyResult, no_dependencies } from "../../types";
import { outflow_repo, Outflow } from "../../repositories";
import {
  OutflowForPeriodGeneration,
  SourcePeriodForOutflowGeneration,
} from "../../domain/outflows";

/**
 * Input for resolving outflow period dependencies.
 */
export interface ResolveOutflowPeriodInput {
  outflow_id: string;
  user_id: string;
  /** Start date for period generation (defaults to outflow first_date) */
  start_date?: Date;
  /** End date for period generation (defaults to 12 months forward) */
  end_date?: Date;
}

/**
 * Dependencies resolved for outflow period generation.
 */
export interface OutflowPeriodDependencies {
  outflow: OutflowForPeriodGeneration;
  source_periods: SourcePeriodForOutflowGeneration[];
  dependency_result: DependencyResult;
}

/**
 * Maps outflow entity from repo to domain format.
 */
function map_outflow_to_domain(outflow: Outflow): OutflowForPeriodGeneration {
  return {
    id: outflow.id,
    owner_id: outflow.user_id,
    created_by: outflow.user_id, // Simplified - repo doesn't track created_by
    group_id: outflow.group_ids[0] ?? null,
    group_ids: outflow.group_ids,
    plaid_item_id: outflow.plaid_item_id,
    account_id: outflow.account_id,
    average_amount: outflow.average_amount,
    last_amount: outflow.last_amount,
    currency: outflow.currency,
    description: outflow.description,
    merchant_name: outflow.merchant_name,
    user_custom_name: outflow.user_custom_name,
    frequency: outflow.frequency,
    first_date: outflow.first_date,
    last_date: outflow.last_date,
    predicted_next_date: outflow.predicted_next_date,
    plaid_primary_category: outflow.plaid_primary_category,
    plaid_detailed_category: outflow.plaid_detailed_category,
    internal_primary_category: outflow.internal_primary_category,
    internal_detailed_category: outflow.internal_detailed_category,
    expense_type: outflow.expense_type,
    is_essential: outflow.is_essential,
    is_active: outflow.is_active,
    is_hidden: outflow.is_hidden,
    source: outflow.source,
    tags: outflow.tags,
    rules: outflow.rules,
    transaction_ids: outflow.transaction_ids,
  };
}

/**
 * Resolve dependencies for outflow period generation.
 *
 * Fetches:
 * 1. The outflow document
 * 2. Source periods within the date range
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with outflow ID and date range
 * @returns Dependencies needed for period generation
 */
export async function resolve_outflow_period_dependencies(
  ctx: TraceContext,
  input: ResolveOutflowPeriodInput
): Promise<OutflowPeriodDependencies> {
  console.log(
    `[${ctx.trace_id}] resolve_outflow_period_dependencies: outflow_id=${input.outflow_id}`
  );

  // 1. Get the outflow document
  const outflow = await outflow_repo.get_by_id(ctx, input.outflow_id);

  if (!outflow) {
    throw new Error(`Outflow not found: ${input.outflow_id}`);
  }

  // Note: is_active validation is done in domain layer, not resolver
  // Resolver only does data lookups, not business logic validation

  // 2. Calculate date range for period generation
  const start_date = input.start_date ?? outflow.first_date.toDate();
  const end_date = input.end_date ?? new Date();
  if (!input.end_date) {
    end_date.setMonth(end_date.getMonth() + 15); // 15 months forward (like legacy)
  }

  console.log(
    `[${ctx.trace_id}] resolve_outflow_period_dependencies: date range ` +
    `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`
  );

  // 3. Query source periods within the date range
  const db = getFirestore();
  /* eslint-disable @typescript-eslint/naming-convention */
  const snapshot = await db
    .collection("source_periods")
    .where("startDate", ">=", Timestamp.fromDate(start_date))
    .where("startDate", "<=", Timestamp.fromDate(end_date))
    .orderBy("startDate", "asc")
    .get();
  /* eslint-enable @typescript-eslint/naming-convention */

  const source_periods: SourcePeriodForOutflowGeneration[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      period_id: data.periodId ?? doc.id,
      type: data.type,
      start_date: data.startDate,
      end_date: data.endDate,
    };
  });

  console.log(
    `[${ctx.trace_id}] resolve_outflow_period_dependencies: found ${source_periods.length} source periods`
  );

  // 4. Return dependencies
  return {
    outflow: map_outflow_to_domain(outflow),
    source_periods,
    dependency_result: no_dependencies(), // Period generation doesn't affect other entities
  };
}

/**
 * Resolve outflow directly from Firestore document data.
 *
 * Used by triggers that have the document data already.
 * Avoids an extra read.
 *
 * @param ctx - Trace context
 * @param outflow_id - Outflow document ID
 * @param outflow_data - Raw Firestore document data (camelCase)
 * @param options - Optional date range overrides
 */
export async function resolve_outflow_period_dependencies_from_doc(
  ctx: TraceContext,
  outflow_id: string,
  outflow_data: Record<string, unknown>,
  options?: { start_date?: Date; end_date?: Date }
): Promise<OutflowPeriodDependencies> {
  console.log(
    `[${ctx.trace_id}] resolve_outflow_period_dependencies_from_doc: outflow_id=${outflow_id}`
  );

  // ===== DIAGNOSTIC LOGGING =====
  console.log(
    `[${ctx.trace_id}] DIAGNOSTIC - Received outflow_data keys: ${Object.keys(outflow_data).join(", ")}`
  );
  console.log(
    `[${ctx.trace_id}] DIAGNOSTIC - outflow_data.ownerId: ${outflow_data.ownerId}, ` +
      `outflow_data.userId: ${outflow_data.userId}, ` +
      `outflow_data.isActive: ${outflow_data.isActive}, ` +
      `outflow_data.frequency: ${outflow_data.frequency}, ` +
      `outflow_data.averageAmount: ${outflow_data.averageAmount}`
  );
  // ===== END DIAGNOSTIC =====

  // Map camelCase Firestore doc to snake_case domain format
  /* eslint-disable @typescript-eslint/naming-convention */
  const first_date = outflow_data.firstDate as Timestamp;
  const last_date = outflow_data.lastDate as Timestamp;
  const predicted_next_date = outflow_data.predictedNextDate as Timestamp | null;

  const outflow: OutflowForPeriodGeneration = {
    id: outflow_id,
    owner_id: (outflow_data.ownerId as string) ?? (outflow_data.userId as string),
    created_by: (outflow_data.createdBy as string) ?? (outflow_data.ownerId as string),
    group_id: (outflow_data.groupId as string) ?? null,
    group_ids: (outflow_data.groupIds as string[]) ??
      (outflow_data.groupId ? [outflow_data.groupId as string] : []),
    plaid_item_id: outflow_data.plaidItemId as string,
    account_id: outflow_data.accountId as string,
    average_amount: outflow_data.averageAmount as number,
    last_amount: (outflow_data.lastAmount as number) ?? (outflow_data.averageAmount as number),
    currency: (outflow_data.currency as string) ?? "USD",
    description: (outflow_data.description as string) ?? null,
    merchant_name: (outflow_data.merchantName as string) ?? null,
    user_custom_name: (outflow_data.userCustomName as string) ?? null,
    frequency: outflow_data.frequency as string,
    first_date,
    last_date,
    predicted_next_date,
    plaid_primary_category: (outflow_data.plaidPrimaryCategory as string) ?? "OTHER",
    plaid_detailed_category: (outflow_data.plaidDetailedCategory as string) ?? "",
    internal_primary_category: (outflow_data.internalPrimaryCategory as string) ?? null,
    internal_detailed_category: (outflow_data.internalDetailedCategory as string) ?? null,
    expense_type: (outflow_data.expenseType as string) ?? "other",
    is_essential: (outflow_data.isEssential as boolean) ?? false,
    is_active: (outflow_data.isActive as boolean) ?? true,
    is_hidden: (outflow_data.isHidden as boolean) ?? false,
    source: (outflow_data.source as string) ?? "plaid",
    tags: (outflow_data.tags as string[]) ?? [],
    rules: (outflow_data.rules as unknown[]) ?? [],
    transaction_ids: (outflow_data.transactionIds as string[]) ?? [],
  };
  /* eslint-enable @typescript-eslint/naming-convention */

  // ===== DIAGNOSTIC LOGGING =====
  console.log(
    `[${ctx.trace_id}] DIAGNOSTIC - Mapped outflow: ` +
      `id=${outflow.id}, ` +
      `owner_id=${outflow.owner_id}, ` +
      `is_active=${outflow.is_active}, ` +
      `frequency=${outflow.frequency}, ` +
      `average_amount=${outflow.average_amount}`
  );
  // ===== END DIAGNOSTIC =====

  // Note: is_active validation is done in domain layer, not resolver
  // Resolver only does data lookups, not business logic validation

  // Calculate date range
  const start_date = options?.start_date ?? first_date.toDate();
  const end_date = options?.end_date ?? new Date();
  if (!options?.end_date) {
    end_date.setMonth(end_date.getMonth() + 15); // 15 months forward
  }

  console.log(
    `[${ctx.trace_id}] resolve_outflow_period_dependencies_from_doc: date range ` +
    `${start_date.toISOString().split("T")[0]} to ${end_date.toISOString().split("T")[0]}`
  );

  // Query source periods
  const db = getFirestore();
  /* eslint-disable @typescript-eslint/naming-convention */
  const snapshot = await db
    .collection("source_periods")
    .where("startDate", ">=", Timestamp.fromDate(start_date))
    .where("startDate", "<=", Timestamp.fromDate(end_date))
    .orderBy("startDate", "asc")
    .get();
  /* eslint-enable @typescript-eslint/naming-convention */

  const source_periods: SourcePeriodForOutflowGeneration[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      period_id: data.periodId ?? doc.id,
      type: data.type,
      start_date: data.startDate,
      end_date: data.endDate,
    };
  });

  console.log(
    `[${ctx.trace_id}] resolve_outflow_period_dependencies_from_doc: found ${source_periods.length} source periods`
  );

  return {
    outflow,
    source_periods,
    dependency_result: no_dependencies(),
  };
}
