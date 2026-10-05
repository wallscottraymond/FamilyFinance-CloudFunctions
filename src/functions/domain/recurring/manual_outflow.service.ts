/**
 * Manual Outflow Service
 *
 * Builds a user-created recurring bill in the same stored shape as a
 * Plaid-detected one, so derive-on-read (period page, Home, widgets) shows it
 * with no special case.
 *
 * @module domain/recurring/manual_outflow
 */

import { DomainResult } from "../../types";
import { OutflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";

/**
 * Frequencies a user can pick when creating a bill. Stored lowercase; the
 * derive path normalizes them (`domain/recurring/frequency.ts`).
 */
export const MANUAL_BILL_FREQUENCIES = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type ManualBillFrequency = (typeof MANUAL_BILL_FREQUENCIES)[number];

/**
 * Validated request to create a bill.
 */
export interface ManualOutflowRequest {
  /** New document ID (chosen by the orchestrator) */
  id: string;
  user_id: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  frequency: ManualBillFrequency;
  expense_type: string;
  is_essential: boolean;
  /** Day of month the bill is due (monthly only) */
  due_day: number | null;
  /** Current time in ms (injected) */
  now_ms: number;
}

/**
 * Days in a UTC month (month is 0-based).
 */
function days_in_month(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The next due date as a UTC-midnight Date.
 *
 * - monthly with a due day: this month's due day if it hasn't passed, else next
 *   month's, clamped to the month's length (a "31st" bill is due Feb 28/29).
 * - everything else: today (the user is creating it as due now; the schedule
 *   repeats from here).
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param frequency - Bill frequency
 * @param due_day - Day of month (monthly only)
 * @param now_ms - Current time in ms
 * @returns Next due date (UTC midnight)
 */
export function compute_manual_next_due_date(
  frequency: ManualBillFrequency,
  due_day: number | null,
  now_ms: number
): Date {
  const now = new Date(now_ms);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();

  if (frequency !== "monthly" || due_day === null) {
    return new Date(Date.UTC(year, month, today));
  }

  const this_month_day = Math.min(due_day, days_in_month(year, month));
  if (this_month_day >= today) {
    return new Date(Date.UTC(year, month, this_month_day));
  }
  const next_year = month === 11 ? year + 1 : year;
  const next_month = (month + 1) % 12;
  return new Date(
    Date.UTC(next_year, next_month, Math.min(due_day, days_in_month(next_year, next_month)))
  );
}

/**
 * Validates the request and builds the bill to persist.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param request - Validated create request
 * @returns The bill entity, or validation errors
 */
export function build_manual_outflow(
  request: ManualOutflowRequest
): DomainResult<OutflowForPersistence> {
  const errors: string[] = [];
  const name = request.name.trim();

  if (name.length === 0) {
    errors.push("Bill name is required");
  }
  if (!(request.amount > 0)) {
    errors.push("Amount must be greater than zero");
  }
  if (request.frequency === "monthly") {
    if (request.due_day === null || request.due_day < 1 || request.due_day > 31) {
      errors.push("Due day must be between 1 and 31");
    }
  }
  if (errors.length > 0) {
    return { validation_errors: errors };
  }

  const next_due = compute_manual_next_due_date(
    request.frequency,
    request.due_day,
    request.now_ms
  );
  const merchant = request.merchant_name?.trim() || null;

  return {
    entity: {
      id: request.id,
      owner_id: request.user_id,
      created_by: request.user_id,
      updated_by: request.user_id,
      group_ids: [],

      // Not from Plaid: no item/stream/account, so Plaid sync and stale-marking
      // (item-scoped) never touch it.
      plaid_item_id: "",
      plaid_stream_id: request.id,
      account_id: "",

      last_amount: request.amount,
      average_amount: request.amount,
      currency: "USD",

      description: name,
      merchant_name: merchant ?? name,
      user_custom_name: name,

      // Cast: the stored frequency set includes "quarterly", which the Plaid
      // AppFrequency type lacks but derive's normalize_frequency handles.
      frequency: request.frequency as OutflowForPersistence["frequency"],
      first_date: next_due,
      last_date: next_due,
      predicted_next_date: next_due,

      plaid_primary_category: "GENERAL_SERVICES",
      plaid_detailed_category: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      internal_primary_category: null,
      internal_detailed_category: null,

      expense_type: request.expense_type,
      is_essential: request.is_essential,

      status: "active",
      source: "manual",
      plaid_status: "MANUAL",
      plaid_confidence_level: null,
      is_active: true,
      is_hidden: false,
      is_user_modified: true,

      transaction_ids: [],
      tags: [],
      rules: [],
    },
  };
}
