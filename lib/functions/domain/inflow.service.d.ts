/**
 * Inflow Domain Service
 *
 * Pure business logic for recurring income (inflow) operations.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/inflow
 */
import { DomainResult } from "../types";
import { InflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
/**
 * Existing inflow data for duplicate detection.
 * Minimal interface to avoid coupling to full entity.
 */
export interface ExistingInflowData {
    id: string;
    payer_name: string | null;
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
    /** New inflows that are not duplicates */
    new_inflows: InflowForPersistence[];
    /** Inflows that may be duplicates of existing items */
    potential_duplicates: Array<{
        new_inflow: InflowForPersistence;
        existing_inflow: ExistingInflowData;
        confidence: "high" | "medium" | "low";
        match_reason: string;
    }>;
}
/**
 * Merge suggestion for Plaid-detected items that match manual items.
 */
export interface InflowMergeSuggestion {
    /** Plaid-detected inflow */
    plaid_inflow: InflowForPersistence;
    /** Existing manual inflow to merge with */
    manual_inflow: ExistingInflowData;
    /** Confidence level of the match */
    confidence: "high" | "medium" | "low";
    /** Why we think these are the same */
    match_reasons: string[];
    /** Suggested action */
    suggested_action: "merge" | "review" | "keep_separate";
}
/**
 * Validates inflows before sync/persistence.
 *
 * Checks:
 * - Required fields are present
 * - Amounts are valid (positive)
 * - Dates are logical (first_date <= last_date)
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param inflows - Inflows to validate
 * @returns Valid inflows and any validation errors
 */
export declare function validate_inflows_for_sync(inflows: InflowForPersistence[]): DomainResult<InflowForPersistence>;
/**
 * Detects potential duplicate inflows.
 *
 * Matching criteria (per project decision):
 * - Merchant/payer name similarity
 * - Amount within 20% tolerance
 * - Same or compatible frequency
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param new_inflows - New inflows from Plaid
 * @param existing_inflows - Existing inflows in the system
 * @returns Detection result with new items and potential duplicates
 */
export declare function detect_duplicate_inflows(new_inflows: InflowForPersistence[], existing_inflows: ExistingInflowData[]): DomainResult<DuplicateDetectionResult>;
/**
 * Computes merge suggestions for Plaid inflows matching manual items.
 *
 * When Plaid detects income that looks like a manually-created inflow,
 * we suggest merging them to avoid duplicates.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_inflows - Newly detected Plaid inflows
 * @param manual_inflows - Existing manual inflows
 * @returns List of merge suggestions
 */
export declare function compute_inflow_merge_suggestions(plaid_inflows: InflowForPersistence[], manual_inflows: ExistingInflowData[]): DomainResult<InflowMergeSuggestion>;
/**
 * Filters inflows to only those that need merge review.
 *
 * PURE FUNCTION.
 *
 * @param inflows - All inflows
 * @returns Inflows with pending_review status
 */
export declare function filter_inflows_needing_review(inflows: InflowForPersistence[]): InflowForPersistence[];
/**
 * Computes the status for a new Plaid inflow.
 *
 * PURE FUNCTION.
 *
 * @param has_similar_manual - Whether a similar manual inflow exists
 * @param plaid_confidence - Plaid's confidence level
 * @returns Appropriate status for the inflow
 */
export declare function compute_inflow_status(has_similar_manual: boolean, plaid_confidence: string | null): "active" | "pending_review" | "inactive";
//# sourceMappingURL=inflow.service.d.ts.map