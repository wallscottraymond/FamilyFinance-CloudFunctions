/**
 * Inflow Period Domain Service
 *
 * PURE business logic for calculating inflow periods.
 * No IO, no side effects, no async operations.
 *
 * @module domain/inflows/inflow_period
 */
import { Timestamp } from "firebase-admin/firestore";
import { DomainResult } from "../../types";
import { InflowPeriodForPersistence } from "../../repositories/inflow_period.repo";
/**
 * Inflow data needed for period generation (snake_case).
 */
export interface InflowForPeriodGeneration {
    id: string;
    owner_id: string;
    created_by: string;
    group_id: string | null;
    group_ids: string[];
    plaid_item_id: string;
    account_id: string;
    average_amount: number;
    currency: string;
    description: string | null;
    payer_name: string | null;
    user_custom_name: string | null;
    frequency: string;
    first_date: Timestamp;
    last_date: Timestamp;
    predicted_next_date: Timestamp | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    income_type: string;
    is_active: boolean;
    is_hidden: boolean;
    source: string;
    tags: string[];
    rules: unknown[];
    transaction_ids: string[];
}
/**
 * Source period data needed for period generation (snake_case).
 */
export interface SourcePeriodForGeneration {
    id: string;
    period_id: string;
    type: string;
    start_date: Timestamp;
    end_date: Timestamp;
}
/**
 * Generate inflow periods for a given inflow and set of source periods.
 *
 * PURE function - no IO, no side effects.
 *
 * @param inflow - The inflow to generate periods for
 * @param source_periods - The source periods to generate inflow periods for
 * @param now - Current timestamp (injected for determinism)
 * @returns DomainResult with inflow periods or validation errors
 */
export declare function compute_inflow_periods(inflow: InflowForPeriodGeneration, source_periods: SourcePeriodForGeneration[], now: Timestamp): DomainResult<InflowPeriodForPersistence>;
/**
 * Validate inflow periods before persistence.
 *
 * PURE function - performs final validation checks.
 *
 * @param entities - Inflow periods to validate
 * @returns DomainResult with validated entities or errors
 */
export declare function validate_inflow_periods(entities: InflowPeriodForPersistence[]): DomainResult<InflowPeriodForPersistence>;
//# sourceMappingURL=inflow_period.service.d.ts.map