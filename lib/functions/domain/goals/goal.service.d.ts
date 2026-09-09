/**
 * Goal Domain Service — Goals (Phase 1)
 *
 * PURE business logic for goals: input validation, per-period cadence
 * translation, and per-period measurement math. No IO, no Timestamps read from
 * the clock — everything is a function of its inputs (deterministic, unit-testable).
 *
 * Measurement is BALANCE-based (per the locked design): the resolver reads
 * balance snapshots + runs the partition allocation, then hands this service the
 * already-attributed numbers to shape into a GoalMeasurement.
 *
 * @module domain/goals/goal
 */
import { Timestamp } from "firebase-admin/firestore";
import { DomainResult } from "../../types/domain";
import { GoalType, GoalCadence, GoalMeasurement, GoalEntity } from "../../types/goals/goal_entity.types";
import { CreateGoalInput, UpdateGoalInput } from "../../types/goals/goal_crud.types";
/** Validated shape for creating a goal (already normalized by the entry layer). */
export interface ValidateGoalInput {
    goal_type: GoalType;
    name: string;
    linked_account_id: string;
    target_amount?: number | null;
    home_cadence: GoalCadence;
    per_period_amount: number;
    baseline_counts_existing: boolean;
    apr?: number | null;
    minimum_payment?: number | null;
    extra_principal?: number | null;
}
/**
 * Validate a goal-creation request. Returns the (unchanged) input on success or
 * a list of human-readable errors. PURE.
 */
export declare function validate_create_goal(input: ValidateGoalInput): DomainResult<ValidateGoalInput>;
/**
 * Assemble a new GoalEntity from a validated create input + resolver-supplied
 * dependencies (baseline balance, next priority rank) + injected clock. PURE.
 */
export declare function compute_create_goal(params: {
    goal_id: string;
    user_id: string;
    input: CreateGoalInput;
    baseline_balance: number;
    priority_rank: number;
    now: Timestamp;
}): DomainResult<GoalEntity>;
/**
 * Merge an update patch onto an existing goal → the full updated entity. PURE.
 * `undefined` leaves a field unchanged; `null` clears a nullable field.
 */
export declare function compute_update_goal(params: {
    existing: GoalEntity;
    input: UpdateGoalInput;
    now: Timestamp;
}): DomainResult<GoalEntity>;
/**
 * Daily set-aside rate implied by a per-period amount in a given home cadence.
 * PURE. e.g. $304.40/month → ~$10/day.
 */
export declare function goal_daily_rate(per_period_amount: number, home_cadence: GoalCadence): number;
/**
 * Translate a goal's per-period set-aside into the amount expected for a viewed
 * period spanning `span_days` days (the viewer's cadence). PURE.
 *
 * Prefer passing the viewed period's ACTUAL day span (from its source period) so
 * month-length variation is exact; callers without it can pass CADENCE_DAYS.
 */
export declare function amount_for_span(per_period_amount: number, home_cadence: GoalCadence, span_days: number): number;
/** Nominal day length of a cadence (for callers without a concrete period span). */
export declare function cadence_days(cadence: GoalCadence): number;
/**
 * Shape a GoalMeasurement from already-resolved inputs. PURE.
 *
 * @param params.goal_type            drives debt (balance-drop) vs save (balance-growth) sign
 * @param params.target_for_period    expected set-aside this period (from amount_for_span)
 * @param params.attributed_progress  net progress attributed to THIS goal this period
 *                                     (post-partition; already signed so positive = good)
 * @param params.cumulative_progress  signed cumulative progress toward target (baseline-relative)
 * @param params.target_amount        goal target (null = ongoing)
 * @param params.data_incomplete      a needed snapshot was missing/stale
 */
export declare function compute_goal_measurement(params: {
    goal_id: string;
    period_id: string;
    target_for_period: number;
    attributed_progress: number;
    cumulative_progress: number;
    target_amount?: number | null;
    data_incomplete: boolean;
}): GoalMeasurement;
//# sourceMappingURL=goal.service.d.ts.map