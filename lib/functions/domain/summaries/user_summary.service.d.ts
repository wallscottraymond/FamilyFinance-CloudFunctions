/**
 * User Summary Domain Service
 *
 * Pure functions for computing user period summaries.
 * NO I/O, NO await, NO repository imports.
 *
 * @module domain/summaries/user_summary
 */
import { Timestamp } from "firebase-admin/firestore";
import { DomainResult } from "../../types";
import { OutflowPeriod, BudgetPeriodDocument, InflowPeriod, SourcePeriod } from "../../../types";
import { UserSummaryForPersistence } from "../../repositories/user_summary.repo";
/**
 * Input for computing a user period summary.
 */
export interface ComputeUserSummaryInput {
    user_id: string;
    source_period: SourcePeriod;
    outflow_periods: OutflowPeriod[];
    budget_periods: BudgetPeriodDocument[];
    inflow_periods: InflowPeriod[];
    now: Timestamp;
}
/**
 * Computes a complete user period summary from resource periods.
 *
 * PURE FUNCTION: No I/O, deterministic, no side effects.
 *
 * @param input - Input containing all resource periods and context
 * @returns DomainResult with computed summary or validation errors
 */
export declare function compute_user_period_summary(input: ComputeUserSummaryInput): DomainResult<UserSummaryForPersistence>;
/**
 * Validates a user period summary before persistence.
 *
 * PURE FUNCTION: No I/O, deterministic.
 *
 * @param entity - The summary to validate
 * @returns DomainResult with entity or validation errors
 */
export declare function validate_user_period_summary(entity: UserSummaryForPersistence): DomainResult<UserSummaryForPersistence>;
//# sourceMappingURL=user_summary.service.d.ts.map