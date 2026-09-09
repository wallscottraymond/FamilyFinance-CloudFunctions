/**
 * Goal Measurement Resolver — Goals (Phase 1)
 *
 * Read-only. For a viewed period, computes each active goal's per-period progress
 * from balance snapshots, attributing a shared account's movement across its
 * goals by priority order (fill the top-ranked goal's target first).
 *
 * Direction is goal-type-aware: save/purchase/invest measure the account balance
 * GROWING; debt_paydown measures the liability balance DROPPING.
 *
 * The pure shaping (met / target_reached / rounding) is delegated to the domain
 * service; this resolver only reads + attributes.
 *
 * @module resolvers/goals/goal_measurement
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { GoalEntity, GoalMeasurement } from "../../types/goals/goal_entity.types";
export interface GoalMeasurementView {
    goal: GoalEntity;
    measurement: GoalMeasurement;
}
export declare function resolve_goal_measurements(ctx: TraceContext, user_id: string, period_id: string, period_start: Timestamp, period_end: Timestamp): Promise<GoalMeasurementView[]>;
//# sourceMappingURL=goal_measurement.resolver.d.ts.map