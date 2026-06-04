/**
 * Budget Entity Types
 *
 * Internal (snake_case) domain representation of budgets and budget periods.
 * The repository layer maps these to/from the existing camelCase Firestore
 * documents (see `Budget` in `src/types/index.ts`) for backwards compatibility.
 *
 * @module types/budgets/budget_entity
 */

import { Timestamp } from "firebase-admin/firestore";

/**
 * Budget period cadence. Mirrors the `BudgetPeriod` enum string values from the
 * legacy types so wire payloads and stored documents stay compatible.
 */
export type BudgetPeriodType =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";

/**
 * Budget classification. `recurring` budgets renew every period; `limited`
 * budgets run for a fixed number of periods.
 */
export type BudgetType = "recurring" | "limited";

/**
 * Period instance cadence. Budget periods are generated against the system's
 * source periods, which only come in these three types (mirrors PeriodType).
 */
export type PeriodInstanceCadence = "weekly" | "monthly" | "bi_monthly";

/**
 * Rollover strategy for carrying surplus/deficit between periods.
 */
export type RolloverStrategy = "immediate" | "spread";

/**
 * Access control block, mirrored from the hybrid document structure.
 * `group_ids` empty array means private.
 */
export interface BudgetAccessControl {
  owner_id: string;
  created_by: string;
  group_ids: string[];
  is_private: boolean;
}

/**
 * Internal budget entity. This is the shape produced by domain services and
 * consumed by the repository. The repository is solely responsible for mapping
 * it to the camelCase Firestore document and back.
 */
export interface BudgetEntity {
  id: string;
  user_id: string;
  group_ids: string[];
  is_active: boolean;

  access: BudgetAccessControl;

  // RBAC ownership
  created_by: string;
  owner_id: string;
  is_private: boolean;

  // Core budget data
  name: string;
  description?: string;
  amount: number;
  currency: string;
  category_ids: string[];
  period: BudgetPeriodType;
  budget_type: BudgetType;

  start_date: Timestamp;
  end_date: Timestamp; // Legacy field, kept for compatibility
  spent: number;
  remaining: number;
  alert_threshold: number;

  // Period integration
  selected_start_period?: string;
  end_period?: string;
  total_periods?: number;
  active_period_range?: {
    start_period: string;
    end_period: string;
  };
  last_extended?: Timestamp;

  // Fixed-end-date support
  is_ongoing: boolean;
  budget_end_date?: Timestamp;

  // System "Everything Else" catch-all flag
  is_system_everything_else?: boolean;

  // Rollover settings (per-budget override)
  rollover_enabled?: boolean;
  rollover_strategy?: RolloverStrategy;
  rollover_spread_periods?: number;

  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * One prime period's contribution to a non-prime period's allocation.
 *
 * Non-prime periods (a weekly period under a monthly budget, etc.) derive their
 * allocation by summing the daily rates of the prime periods they overlap. This
 * records, per overlapping prime, how many days it contributed and the resulting
 * amount — consumed by the mobile non-prime editor to explain the allocation.
 *
 * Stored on the period document (camelCase) as `primePeriodBreakdown`.
 */
export interface PrimePeriodBreakdownEntry {
  prime_period_id: string; // budget_period id of the contributing prime
  source_period_id: string; // the prime's source period id
  days_contributed: number;
  daily_rate: number; // the prime's daily rate (6-decimal)
  amount_contributed: number; // days_contributed-weighted sum (2-decimal)
  overlap_start: Timestamp;
  overlap_end: Timestamp;
}

/**
 * Internal budget period entity. Instances the user interacts with daily.
 * Mapped to/from the `budget_periods` collection by the period repository.
 */
export interface BudgetPeriodEntity {
  id: string;
  budget_id: string;
  user_id: string;
  group_ids: string[];
  /** Denormalized from the parent budget so the period is self-contained. */
  category_ids: string[];
  period_id: string; // e.g. "2025M03", "2025BM03A", "2025W12"
  period_type: PeriodInstanceCadence;

  allocated_amount: number;
  rolled_over_amount: number;
  effective_amount: number;
  spent: number;
  remaining: number;
  daily_rate: number;

  start_date: Timestamp;
  end_date: Timestamp;

  /**
   * Prime/non-prime overlap breakdown. A period is "prime" when its cadence
   * matches the budget's own cadence (allocated 1:1); non-prime periods derive
   * their allocation from the overlapping prime periods. Optional because read
   * paths (map_to_entity) and in-place reallocation don't always populate them.
   */
  is_prime?: boolean;
  days_in_period?: number;
  prime_period_ids?: string[];
  prime_period_breakdown?: PrimePeriodBreakdownEntry[];

  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}
