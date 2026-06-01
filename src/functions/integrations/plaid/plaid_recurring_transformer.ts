/**
 * Plaid Recurring Transaction Transformer
 *
 * PURE functions that convert Plaid recurring transaction streams to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_recurring_transformer
 */

import {
  TransactionStream,
  RecurringTransactionFrequency,
} from "plaid";
import { DomainResult } from "../../types";

// ============================================================================
// Types
// ============================================================================

/**
 * App frequency values (lowercase for consistency).
 */
export type AppFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "yearly"
  | "unknown";

/**
 * Recurring item status for UX flows.
 */
export type RecurringStatus = "active" | "pending_review" | "inactive";

/**
 * Source of the recurring item.
 */
export type RecurringSource = "manual" | "plaid" | "merged";

/**
 * Context for transforming Plaid recurring streams.
 */
export interface RecurringTransformContext {
  user_id: string;
  plaid_item_id: string;
  group_ids: string[];
  account_id?: string;
}

/**
 * Inflow (recurring income) prepared for persistence.
 * Does NOT include timestamps - repository adds those.
 */
export interface InflowForPersistence {
  // Identity
  id: string; // Plaid stream_id

  // Ownership
  owner_id: string;
  created_by: string;
  updated_by: string;
  group_ids: string[];

  // Plaid references
  plaid_item_id: string;
  plaid_stream_id: string;
  account_id: string;

  // Financial data
  last_amount: number;
  average_amount: number;
  amount_min?: number;
  amount_max?: number;
  currency: string;

  // Description
  description: string | null;
  payer_name: string | null;
  user_custom_name: string | null;

  // Timing
  frequency: AppFrequency;
  first_date: Date;
  last_date: Date;
  predicted_next_date: Date | null;

  // Categories
  plaid_primary_category: string;
  plaid_detailed_category: string;
  internal_primary_category: string | null;
  internal_detailed_category: string | null;

  // Classification
  income_type: string;
  is_regular_salary: boolean;
  is_variable: boolean;

  // Status
  status: RecurringStatus;
  source: RecurringSource;
  plaid_status: string;
  plaid_confidence_level: string | null;
  is_active: boolean;
  is_hidden: boolean;
  is_user_modified: boolean;

  // References
  transaction_ids: string[];
  tags: string[];
  rules: unknown[];
}

/**
 * Outflow (recurring expense) prepared for persistence.
 * Does NOT include timestamps - repository adds those.
 */
export interface OutflowForPersistence {
  // Identity
  id: string; // Plaid stream_id

  // Ownership
  owner_id: string;
  created_by: string;
  updated_by: string;
  group_ids: string[];

  // Plaid references
  plaid_item_id: string;
  plaid_stream_id: string;
  account_id: string;

  // Financial data
  last_amount: number;
  average_amount: number;
  amount_min?: number;
  amount_max?: number;
  currency: string;

  // Description
  description: string | null;
  merchant_name: string | null;
  user_custom_name: string | null;

  // Timing
  frequency: AppFrequency;
  first_date: Date;
  last_date: Date;
  predicted_next_date: Date | null;

  // Categories
  plaid_primary_category: string;
  plaid_detailed_category: string;
  internal_primary_category: string | null;
  internal_detailed_category: string | null;

  // Classification
  expense_type: string;
  is_essential: boolean;

  // Status
  status: RecurringStatus;
  source: RecurringSource;
  plaid_status: string;
  plaid_confidence_level: string | null;
  is_active: boolean;
  is_hidden: boolean;
  is_user_modified: boolean;

  // References
  transaction_ids: string[];
  tags: string[];
  rules: unknown[];
}

// ============================================================================
// Frequency Mapping (PURE)
// ============================================================================

/**
 * Maps Plaid recurring frequency to app frequency.
 *
 * PURE FUNCTION.
 *
 * @param plaid_frequency - Plaid frequency enum value
 * @returns App frequency string
 */
export function map_plaid_frequency_to_app(
  plaid_frequency: RecurringTransactionFrequency | string
): AppFrequency {
  const freq = String(plaid_frequency).toUpperCase();

  switch (freq) {
    case "WEEKLY":
      return "weekly";
    case "BIWEEKLY":
      return "biweekly";
    case "SEMI_MONTHLY":
      return "semimonthly";
    case "MONTHLY":
      return "monthly";
    case "ANNUALLY":
      return "yearly";
    case "UNKNOWN":
    default:
      return "monthly"; // Default to monthly for unknown
  }
}

// ============================================================================
// Inflow Transform (PURE)
// ============================================================================

/**
 * Transforms Plaid inflow streams (income) to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Does NOT add timestamps - repository handles that.
 *
 * @param inflow_streams - Raw inflow streams from Plaid RecurringTransactionsGetResponse
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
export function transform_inflow_streams(
  inflow_streams: TransactionStream[],
  context: RecurringTransformContext
): DomainResult<InflowForPersistence> {
  const validation_errors: string[] = [];
  const entities: InflowForPersistence[] = [];

  for (const stream of inflow_streams) {
    // Validate required fields
    if (!stream.stream_id) {
      validation_errors.push("Inflow stream missing stream_id");
      continue;
    }

    if (!stream.account_id) {
      validation_errors.push(`Inflow stream ${stream.stream_id} missing account_id`);
      continue;
    }

    // Extract amounts (inflows are negative in Plaid, we store as positive)
    const last_amount = Math.abs(stream.last_amount?.amount ?? 0);
    const average_amount = Math.abs(stream.average_amount?.amount ?? 0);

    // Calculate min/max from available data (simplified - real calculation would use transaction history)
    const amount_min = Math.min(last_amount, average_amount);
    const amount_max = Math.max(last_amount, average_amount);

    // Determine if it's variable income (difference > 10%)
    const variance = average_amount > 0
      ? Math.abs(last_amount - average_amount) / average_amount
      : 0;
    const is_variable = variance > 0.1;

    // Extract categories
    const plaid_primary = stream.personal_finance_category?.primary ?? "INCOME";
    const plaid_detailed = stream.personal_finance_category?.detailed ?? "INCOME_OTHER";

    // Classify income type
    const income_type = classify_income_type(plaid_detailed);
    const is_regular_salary = plaid_detailed === "INCOME_WAGES";

    // Determine status - new Plaid items start as pending_review
    const status: RecurringStatus = "pending_review";

    const entity: InflowForPersistence = {
      // Identity
      id: stream.stream_id,

      // Ownership
      owner_id: context.user_id,
      created_by: context.user_id,
      updated_by: context.user_id,
      group_ids: context.group_ids,

      // Plaid references
      plaid_item_id: context.plaid_item_id,
      plaid_stream_id: stream.stream_id,
      account_id: stream.account_id,

      // Financial data
      last_amount,
      average_amount,
      amount_min,
      amount_max,
      currency: stream.average_amount?.iso_currency_code ?? "USD",

      // Description
      description: stream.description ?? null,
      payer_name: stream.merchant_name ?? null,
      user_custom_name: null,

      // Timing
      frequency: map_plaid_frequency_to_app(stream.frequency),
      first_date: new Date(stream.first_date),
      last_date: new Date(stream.last_date),
      predicted_next_date: stream.predicted_next_date
        ? new Date(stream.predicted_next_date)
        : null,

      // Categories
      plaid_primary_category: plaid_primary,
      plaid_detailed_category: plaid_detailed,
      internal_primary_category: null,
      internal_detailed_category: null,

      // Classification
      income_type,
      is_regular_salary,
      is_variable,

      // Status
      status,
      source: "plaid",
      plaid_status: stream.status ?? "UNKNOWN",
      plaid_confidence_level: stream.personal_finance_category?.confidence_level ?? null,
      is_active: stream.is_active ?? true,
      is_hidden: false,
      is_user_modified: stream.is_user_modified ?? false,

      // References
      transaction_ids: stream.transaction_ids ?? [],
      tags: [],
      rules: [],
    };

    entities.push(entity);
  }

  if (validation_errors.length > 0) {
    return { entities, validation_errors };
  }

  return { entities };
}

// ============================================================================
// Outflow Transform (PURE)
// ============================================================================

/**
 * Transforms Plaid outflow streams (expenses) to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Does NOT add timestamps - repository handles that.
 *
 * @param outflow_streams - Raw outflow streams from Plaid RecurringTransactionsGetResponse
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
export function transform_outflow_streams(
  outflow_streams: TransactionStream[],
  context: RecurringTransformContext
): DomainResult<OutflowForPersistence> {
  const validation_errors: string[] = [];
  const entities: OutflowForPersistence[] = [];

  for (const stream of outflow_streams) {
    // Validate required fields
    if (!stream.stream_id) {
      validation_errors.push("Outflow stream missing stream_id");
      continue;
    }

    if (!stream.account_id) {
      validation_errors.push(`Outflow stream ${stream.stream_id} missing account_id`);
      continue;
    }

    // Extract amounts (outflows are positive in Plaid, store as positive)
    const last_amount = Math.abs(stream.last_amount?.amount ?? 0);
    const average_amount = Math.abs(stream.average_amount?.amount ?? 0);

    // Calculate min/max from available data
    const amount_min = Math.min(last_amount, average_amount);
    const amount_max = Math.max(last_amount, average_amount);

    // Extract categories
    const plaid_primary = stream.personal_finance_category?.primary ?? "GENERAL_SERVICES";
    const plaid_detailed = stream.personal_finance_category?.detailed ?? "GENERAL_SERVICES_OTHER";

    // Classify expense type and essentiality
    const expense_type = classify_expense_type(plaid_detailed, stream.frequency);
    const is_essential = is_essential_expense(plaid_primary, plaid_detailed);

    // Determine status - new Plaid items start as pending_review
    const status: RecurringStatus = "pending_review";

    const entity: OutflowForPersistence = {
      // Identity
      id: stream.stream_id,

      // Ownership
      owner_id: context.user_id,
      created_by: context.user_id,
      updated_by: context.user_id,
      group_ids: context.group_ids,

      // Plaid references
      plaid_item_id: context.plaid_item_id,
      plaid_stream_id: stream.stream_id,
      account_id: stream.account_id,

      // Financial data
      last_amount,
      average_amount,
      amount_min,
      amount_max,
      currency: stream.average_amount?.iso_currency_code ?? "USD",

      // Description
      description: stream.description ?? null,
      merchant_name: stream.merchant_name ?? null,
      user_custom_name: null,

      // Timing
      frequency: map_plaid_frequency_to_app(stream.frequency),
      first_date: new Date(stream.first_date),
      last_date: new Date(stream.last_date),
      predicted_next_date: stream.predicted_next_date
        ? new Date(stream.predicted_next_date)
        : null,

      // Categories
      plaid_primary_category: plaid_primary,
      plaid_detailed_category: plaid_detailed,
      internal_primary_category: null,
      internal_detailed_category: null,

      // Classification
      expense_type,
      is_essential,

      // Status
      status,
      source: "plaid",
      plaid_status: stream.status ?? "UNKNOWN",
      plaid_confidence_level: stream.personal_finance_category?.confidence_level ?? null,
      is_active: stream.is_active ?? true,
      is_hidden: false,
      is_user_modified: stream.is_user_modified ?? false,

      // References
      transaction_ids: stream.transaction_ids ?? [],
      tags: [],
      rules: [],
    };

    entities.push(entity);
  }

  if (validation_errors.length > 0) {
    return { entities, validation_errors };
  }

  return { entities };
}

// ============================================================================
// Helper Functions (PURE)
// ============================================================================

/**
 * Classifies income type from Plaid detailed category.
 *
 * PURE FUNCTION.
 */
function classify_income_type(plaid_detailed: string): string {
  const detailed = plaid_detailed.toUpperCase();

  if (detailed.includes("WAGES") || detailed.includes("SALARY")) {
    return "salary";
  }
  if (detailed.includes("DIVIDENDS") || detailed.includes("INTEREST")) {
    return "investment";
  }
  if (detailed.includes("RENTAL")) {
    return "rental";
  }
  if (detailed.includes("RETIREMENT") || detailed.includes("PENSION")) {
    return "pension";
  }
  if (detailed.includes("GOVERNMENT") || detailed.includes("TAX_REFUND")) {
    return "government";
  }
  if (detailed.includes("FREELANCE") || detailed.includes("CONTRACT")) {
    return "freelance";
  }

  return "other";
}

/**
 * Classifies expense type from Plaid detailed category.
 *
 * PURE FUNCTION.
 */
function classify_expense_type(
  plaid_detailed: string,
  frequency: RecurringTransactionFrequency | string
): string {
  const detailed = plaid_detailed.toUpperCase();

  if (detailed.includes("UTILITIES") ||
      detailed.includes("ELECTRIC") ||
      detailed.includes("GAS") ||
      detailed.includes("WATER")) {
    return "utility";
  }
  if (detailed.includes("RENT") || detailed.includes("MORTGAGE")) {
    return "rent";
  }
  if (detailed.includes("INSURANCE")) {
    return "insurance";
  }
  if (detailed.includes("LOAN") || detailed.includes("CREDIT_CARD_PAYMENT")) {
    return "loan";
  }
  if (detailed.includes("TAX")) {
    return "tax";
  }

  // Default to subscription for monthly/annual recurring
  const freq = String(frequency).toUpperCase();
  if (freq === "MONTHLY" || freq === "ANNUALLY") {
    return "subscription";
  }

  return "other";
}

/**
 * Determines if expense is essential based on Plaid categories.
 *
 * PURE FUNCTION.
 */
function is_essential_expense(
  plaid_primary: string,
  plaid_detailed: string
): boolean {
  const primary = plaid_primary.toUpperCase();
  const detailed = plaid_detailed.toUpperCase();

  const essential_keywords = [
    "RENT",
    "MORTGAGE",
    "UTILITIES",
    "ELECTRIC",
    "GAS",
    "WATER",
    "INSURANCE",
    "LOAN",
    "HEALTHCARE",
    "MEDICAL",
    "PHARMACY",
    "GROCERIES",
  ];

  return essential_keywords.some(
    (keyword) => primary.includes(keyword) || detailed.includes(keyword)
  );
}

/**
 * Calculates next due date based on last date and frequency.
 *
 * PURE FUNCTION.
 *
 * @param last_date - Last occurrence date
 * @param frequency - App frequency
 * @returns Next predicted due date
 */
export function calculate_next_due_date(
  last_date: Date,
  frequency: AppFrequency
): Date {
  const next = new Date(last_date);

  switch (frequency) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      break;
    case "semimonthly":
      next.setDate(next.getDate() + 15);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      break;
    case "unknown":
    default:
      next.setMonth(next.getMonth() + 1);
      break;
  }

  return next;
}
