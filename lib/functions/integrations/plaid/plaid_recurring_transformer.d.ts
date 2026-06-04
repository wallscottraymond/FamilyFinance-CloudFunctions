/**
 * Plaid Recurring Transaction Transformer
 *
 * PURE functions that convert Plaid recurring transaction streams to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_recurring_transformer
 */
import { TransactionStream, RecurringTransactionFrequency } from "plaid";
import { DomainResult } from "../../types";
/**
 * App frequency values (lowercase for consistency).
 */
export type AppFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "yearly" | "unknown";
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
    id: string;
    owner_id: string;
    created_by: string;
    updated_by: string;
    group_ids: string[];
    plaid_item_id: string;
    plaid_stream_id: string;
    account_id: string;
    last_amount: number;
    average_amount: number;
    amount_min?: number;
    amount_max?: number;
    currency: string;
    description: string | null;
    payer_name: string | null;
    user_custom_name: string | null;
    frequency: AppFrequency;
    first_date: Date;
    last_date: Date;
    predicted_next_date: Date | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    income_type: string;
    is_regular_salary: boolean;
    is_variable: boolean;
    status: RecurringStatus;
    source: RecurringSource;
    plaid_status: string;
    plaid_confidence_level: string | null;
    is_active: boolean;
    is_hidden: boolean;
    is_user_modified: boolean;
    transaction_ids: string[];
    tags: string[];
    rules: unknown[];
}
/**
 * Outflow (recurring expense) prepared for persistence.
 * Does NOT include timestamps - repository adds those.
 */
export interface OutflowForPersistence {
    id: string;
    owner_id: string;
    created_by: string;
    updated_by: string;
    group_ids: string[];
    plaid_item_id: string;
    plaid_stream_id: string;
    account_id: string;
    last_amount: number;
    average_amount: number;
    amount_min?: number;
    amount_max?: number;
    currency: string;
    description: string | null;
    merchant_name: string | null;
    user_custom_name: string | null;
    frequency: AppFrequency;
    first_date: Date;
    last_date: Date;
    predicted_next_date: Date | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    expense_type: string;
    is_essential: boolean;
    status: RecurringStatus;
    source: RecurringSource;
    plaid_status: string;
    plaid_confidence_level: string | null;
    is_active: boolean;
    is_hidden: boolean;
    is_user_modified: boolean;
    transaction_ids: string[];
    tags: string[];
    rules: unknown[];
}
/**
 * Maps Plaid recurring frequency to app frequency.
 *
 * PURE FUNCTION.
 *
 * @param plaid_frequency - Plaid frequency enum value
 * @returns App frequency string
 */
export declare function map_plaid_frequency_to_app(plaid_frequency: RecurringTransactionFrequency | string): AppFrequency;
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
export declare function transform_inflow_streams(inflow_streams: TransactionStream[], context: RecurringTransformContext): DomainResult<InflowForPersistence>;
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
export declare function transform_outflow_streams(outflow_streams: TransactionStream[], context: RecurringTransformContext): DomainResult<OutflowForPersistence>;
/**
 * Calculates next due date based on last date and frequency.
 *
 * PURE FUNCTION.
 *
 * @param last_date - Last occurrence date
 * @param frequency - App frequency
 * @returns Next predicted due date
 */
export declare function calculate_next_due_date(last_date: Date, frequency: AppFrequency): Date;
//# sourceMappingURL=plaid_recurring_transformer.d.ts.map