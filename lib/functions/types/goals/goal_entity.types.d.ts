/**
 * Goal Entity Types — Goals (Phase 1)
 *
 * Internal (snake_case) domain representation of a Goal: a cross-period
 * commitment of money toward an outcome, measured by ACCOUNT-BALANCE progress
 * (not transaction matching). The repository maps these to/from the camelCase
 * `goals` Firestore document.
 *
 * Design locked 2026-09-08 (see FamilyFinanceObsidian/1 Projects/Goals.md).
 *
 * @module types/goals/goal_entity
 */
import { Timestamp } from "firebase-admin/firestore";
/** The four goal kinds. */
export type GoalType = "debt_paydown" | "big_purchase" | "savings" | "invest";
/** Lifecycle. `completed` = target reached (celebrated); `archived` = off the active view. */
export type GoalStatus = "active" | "completed" | "archived";
/**
 * The cadence the user set the per-period amount in ("$X per week/month/…").
 * Mirrors the budget PeriodInstanceCadence so cadence translation is shared.
 */
export type GoalCadence = "weekly" | "monthly" | "bi_monthly";
/** Access control block, mirrored from the hybrid document structure. */
export interface GoalAccessControl {
    owner_id: string;
    created_by: string;
    group_ids: string[];
    is_private: boolean;
}
/**
 * Internal goal entity — produced by domain services, consumed by the repo.
 * The repo maps it to the camelCase `goals` document and back.
 */
export interface GoalEntity {
    id: string;
    user_id: string;
    group_ids: string[];
    is_active: boolean;
    access: GoalAccessControl;
    created_by: string;
    owner_id: string;
    is_private: boolean;
    goal_type: GoalType;
    name: string;
    status: GoalStatus;
    /** The account whose balance this goal watches (a liability for debt goals). */
    linked_account_id: string;
    /**
     * Target dollar amount. Null for ongoing savings/invest goals (no end target —
     * they only check per-period growth).
     */
    target_amount?: number | null;
    /** Optional deadline; null/undefined = ongoing. */
    end_date?: Timestamp | null;
    home_cadence: GoalCadence;
    per_period_amount: number;
    /** The linked account's balance at goal creation. */
    baseline_balance: number;
    /** If true, existing balance counts toward the target; else only growth after creation. */
    baseline_counts_existing: boolean;
    /** Per-account ordering for partition allocation (lower rank = filled first). */
    priority_rank: number;
    /**
     * Whether this goal's per-period set-aside draws against period income
     * (reduces "available to spend"). Locked default = true.
     */
    draws_income: boolean;
    /** An existing recurring outflow the user already pays toward this (pre-fill only). */
    linked_recurring_id?: string | null;
    /** Manual fallback when Plaid didn't enrich the liability (Investments-And-Liabilities). */
    apr?: number | null;
    minimum_payment?: number | null;
    /** Committed extra principal per period (draws income + drives the payoff projection). */
    extra_principal?: number | null;
    created_at: Timestamp;
    updated_at: Timestamp;
}
/**
 * Per-period measurement result for one goal in one viewed period. Produced by
 * the measurement resolver from balance snapshots + the partition ledger.
 */
export interface GoalMeasurement {
    goal_id: string;
    period_id: string;
    /** The set-aside expected this period, in the viewer's cadence. */
    target_for_period: number;
    /** Net balance progress attributed to this goal this period (post-partition). */
    progress_for_period: number;
    /** Cumulative progress toward `target_amount` (relative to baseline). */
    cumulative_progress: number;
    /** For ongoing goals: did this period meet its target? */
    met: boolean;
    /** True when the goal's cumulative target is reached. */
    target_reached: boolean;
    /** True when a needed balance snapshot was missing/stale (progress is best-effort). */
    data_incomplete: boolean;
}
//# sourceMappingURL=goal_entity.types.d.ts.map