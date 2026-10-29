/**
 * Add Income on the new path (Convert-To-Recurring D43) — PURE.
 *
 * Builds a hand-added income through the same builder convert uses (v2 stamp, source manual, the
 * account + vendor key only when they come from a real transaction), and carries every setting the
 * Add Income form collects — income type, variability, hourly / commission / bonus / variable
 * config, `isUserClassified`, `isPrivate` — exactly as the legacy callable wrote them.
 *
 * @module domain/recurring/manual_inflow
 */

import type { InflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
import { ConvertFrequency, build_converted_recurring, utc_day_start } from "./convert_recurring.service";
import { normalize_frequency } from "./frequency";

/** The form's frequency spelling (Plaid-style or lowercase) → a supported schedule; null = unknown. */
export function to_convert_frequency(raw: string | null | undefined): ConvertFrequency | null {
  switch (normalize_frequency(raw)) {
  case "WEEKLY": return "weekly";
  case "BIWEEKLY": return "biweekly";
  case "SEMIMONTHLY": return "semimonthly";
  case "MONTHLY": return "monthly";
  case "QUARTERLY": return "quarterly";
  case "ANNUALLY": return "yearly";
  default: return null;
  }
}

export interface ManualInflowRequest {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  frequency: ConvertFrequency;
  first_expected_ms: number;
  description: string | null;
  income_type: string;
  is_regular_salary: boolean;
  income_variability: string;
  hourly_config: unknown;
  commission_config: unknown;
  bonus_config: unknown;
  variable_config: unknown;
  account_id: string;
  vendor_key: string | null;
  now_ms: number;
}

export function build_manual_inflow(req: ManualInflowRequest): { errors?: string[]; inflow?: InflowForPersistence } {
  const day = utc_day_start(req.first_expected_ms);
  const built = build_converted_recurring({
    id: req.id, direction: "inflow", user_id: req.user_id, name: req.name, amount: req.amount, frequency: req.frequency,
    next_due_ms: req.first_expected_ms, first_date_ms: req.first_expected_ms, account_id: req.account_id,
    vendor_key: req.vendor_key, merchant_source: req.name, converted_from_txn_id: null, now_ms: req.now_ms,
    plaid_primary_category: "INCOME", plaid_detailed_category: "INCOME_OTHER",
    expected_amount_override: null, // hand-added income carries no override (as before)
    description: req.description ?? req.name,
    is_user_modified: false,
    income_type: req.income_type,
    is_regular_salary: req.is_regular_salary,
    income_extras: {
      isPrivate: true,
      incomeVariability: req.income_variability,
      isUserClassified: true,
      hourlyConfig: req.hourly_config ?? null,
      commissionConfig: req.commission_config ?? null,
      bonusConfig: req.bonus_config ?? null,
      variableConfig: req.variable_config ?? null,
      plaidCategoryId: null,
      unofficialCurrency: null,
    },
  });
  void day;
  return built.errors ? { errors: built.errors } : { inflow: built.inflow };
}
