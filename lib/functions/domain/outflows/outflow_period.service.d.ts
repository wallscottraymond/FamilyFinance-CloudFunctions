/**
 * Outflow Period Domain Service
 *
 * PURE business logic for calculating outflow periods.
 * No IO, no side effects, no async operations.
 *
 * @module domain/outflows/outflow_period
 */
import { Timestamp } from "firebase-admin/firestore";
import { DomainResult } from "../../types";
import { OutflowPeriodForPersistence } from "../../repositories/outflow_period.repo";
/**
 * Outflow data needed for period generation (snake_case).
 */
export interface OutflowForPeriodGeneration {
    id: string;
    owner_id: string;
    created_by: string;
    group_id: string | null;
    group_ids: string[];
    plaid_item_id: string;
    account_id: string;
    average_amount: number;
    last_amount: number;
    currency: string;
    description: string | null;
    merchant_name: string | null;
    user_custom_name: string | null;
    frequency: string;
    first_date: Timestamp;
    last_date: Timestamp;
    predicted_next_date: Timestamp | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    expense_type: string;
    is_essential: boolean;
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
export interface SourcePeriodForOutflowGeneration {
    id: string;
    period_id: string;
    type: string;
    start_date: Timestamp;
    end_date: Timestamp;
}
/**
 * Generate outflow periods for a given outflow and set of source periods.
 *
 * PURE function - no IO, no side effects.
 *
 * @param outflow - The outflow to generate periods for
 * @param source_periods - The source periods to generate outflow periods for
 * @param now - Current timestamp (injected for determinism)
 * @returns DomainResult with outflow periods or validation errors
 */
export declare function compute_outflow_periods(outflow: OutflowForPeriodGeneration, source_periods: SourcePeriodForOutflowGeneration[], now: Timestamp): DomainResult<OutflowPeriodForPersistence>;
/**
 * Validate outflow periods before persistence.
 *
 * PURE function - performs final validation checks.
 *
 * @param entities - Outflow periods to validate
 * @returns DomainResult with validated entities or errors
 */
export declare function validate_outflow_periods(entities: OutflowPeriodForPersistence[]): DomainResult<OutflowPeriodForPersistence>;
//# sourceMappingURL=outflow_period.service.d.ts.map