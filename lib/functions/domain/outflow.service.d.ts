/**
 * Outflow Domain Service
 *
 * Pure business logic for recurring expense (outflow) operations.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/outflow
 */
import { DomainResult } from "../types";
import { OutflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
/**
 * Existing outflow data for duplicate detection.
 * Minimal interface to avoid coupling to full entity.
 */
export interface ExistingOutflowData {
    id: string;
    merchant_name: string | null;
    description: string | null;
    average_amount: number;
    frequency: string;
    source: string;
    is_active: boolean;
    plaid_stream_id?: string;
}
/**
 * Result of duplicate detection.
 */
export interface DuplicateDetectionResult {
    /** New outflows that are not duplicates */
    new_outflows: OutflowForPersistence[];
    /** Outflows that may be duplicates of existing items */
    potential_duplicates: Array<{
        new_outflow: OutflowForPersistence;
        existing_outflow: ExistingOutflowData;
        confidence: "high" | "medium" | "low";
        match_reason: string;
    }>;
}
/**
 * Merge suggestion for Plaid-detected items that match manual items.
 */
export interface OutflowMergeSuggestion {
    /** Plaid-detected outflow */
    plaid_outflow: OutflowForPersistence;
    /** Existing manual outflow to merge with */
    manual_outflow: ExistingOutflowData;
    /** Confidence level of the match */
    confidence: "high" | "medium" | "low";
    /** Why we think these are the same */
    match_reasons: string[];
    /** Suggested action */
    suggested_action: "merge" | "review" | "keep_separate";
}
/**
 * Validates outflows before sync/persistence.
 *
 * Checks:
 * - Required fields are present
 * - Amounts are valid (positive)
 * - Dates are logical (first_date <= last_date)
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param outflows - Outflows to validate
 * @returns Valid outflows and any validation errors
 */
export declare function validate_outflows_for_sync(outflows: OutflowForPersistence[]): DomainResult<OutflowForPersistence>;
/**
 * Detects potential duplicate outflows.
 *
 * Matching criteria (per project decision):
 * - Merchant name similarity
 * - Amount within 20% tolerance
 * - Same or compatible frequency
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param new_outflows - New outflows from Plaid
 * @param existing_outflows - Existing outflows in the system
 * @returns Detection result with new items and potential duplicates
 */
export declare function detect_duplicate_outflows(new_outflows: OutflowForPersistence[], existing_outflows: ExistingOutflowData[]): DomainResult<DuplicateDetectionResult>;
/**
 * Computes merge suggestions for Plaid outflows matching manual items.
 *
 * When Plaid detects a recurring expense that looks like a manually-created
 * outflow, we suggest merging them to avoid duplicates.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_outflows - Newly detected Plaid outflows
 * @param manual_outflows - Existing manual outflows
 * @returns List of merge suggestions
 */
export declare function compute_outflow_merge_suggestions(plaid_outflows: OutflowForPersistence[], manual_outflows: ExistingOutflowData[]): DomainResult<OutflowMergeSuggestion>;
/**
 * Filters outflows to only those that need merge review.
 *
 * PURE FUNCTION.
 *
 * @param outflows - All outflows
 * @returns Outflows with pending_review status
 */
export declare function filter_outflows_needing_review(outflows: OutflowForPersistence[]): OutflowForPersistence[];
/**
 * Computes the status for a new Plaid outflow.
 *
 * PURE FUNCTION.
 *
 * @param has_similar_manual - Whether a similar manual outflow exists
 * @param plaid_confidence - Plaid's confidence level
 * @returns Appropriate status for the outflow
 */
export declare function compute_outflow_status(has_similar_manual: boolean, plaid_confidence: string | null): "active" | "pending_review" | "inactive";
/**
 * Categorizes outflows by expense type for analysis.
 *
 * PURE FUNCTION.
 *
 * @param outflows - Outflows to categorize
 * @returns Map of expense type to outflows
 */
export declare function categorize_outflows_by_type(outflows: OutflowForPersistence[]): Map<string, OutflowForPersistence[]>;
/**
 * Computes total monthly outflow amount.
 *
 * Normalizes different frequencies to monthly equivalent.
 *
 * PURE FUNCTION.
 *
 * @param outflows - Outflows to sum
 * @returns Total monthly amount
 */
export declare function compute_monthly_outflow_total(outflows: OutflowForPersistence[]): number;
//# sourceMappingURL=outflow.service.d.ts.map