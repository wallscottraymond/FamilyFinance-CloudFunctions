/**
 * Outflow Domain Service
 *
 * Pure business logic for recurring expense (outflow) operations.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/outflow
 */

import { DomainResult, success_many, partial_success } from "../types";
import {
  OutflowForPersistence,
  AppFrequency,
} from "../integrations/plaid/plaid_recurring_transformer";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Validation Functions (PURE)
// ============================================================================

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
export function validate_outflows_for_sync(
  outflows: OutflowForPersistence[]
): DomainResult<OutflowForPersistence> {
  const valid_outflows: OutflowForPersistence[] = [];
  const validation_errors: string[] = [];

  for (const outflow of outflows) {
    const errors = validate_single_outflow(outflow);

    if (errors.length === 0) {
      valid_outflows.push(outflow);
    } else {
      validation_errors.push(
        `Outflow ${outflow.id}: ${errors.join(", ")}`
      );
    }
  }

  if (validation_errors.length > 0) {
    return partial_success(valid_outflows, validation_errors);
  }

  return success_many(valid_outflows);
}

/**
 * Validates a single outflow.
 *
 * PURE FUNCTION.
 */
function validate_single_outflow(outflow: OutflowForPersistence): string[] {
  const errors: string[] = [];

  // Required fields
  if (!outflow.id) {
    errors.push("missing id");
  }
  if (!outflow.owner_id) {
    errors.push("missing owner_id");
  }
  if (!outflow.plaid_item_id) {
    errors.push("missing plaid_item_id");
  }
  if (!outflow.account_id) {
    errors.push("missing account_id");
  }

  // Amount validation
  if (outflow.average_amount < 0) {
    errors.push("average_amount cannot be negative");
  }
  if (outflow.last_amount < 0) {
    errors.push("last_amount cannot be negative");
  }

  // Date validation
  if (outflow.first_date && outflow.last_date) {
    if (outflow.first_date > outflow.last_date) {
      errors.push("first_date cannot be after last_date");
    }
  }

  // Frequency validation
  const valid_frequencies: AppFrequency[] = [
    "weekly", "biweekly", "semimonthly", "monthly", "yearly", "unknown"
  ];
  if (!valid_frequencies.includes(outflow.frequency as AppFrequency)) {
    errors.push(`invalid frequency: ${outflow.frequency}`);
  }

  return errors;
}

// ============================================================================
// Duplicate Detection (PURE)
// ============================================================================

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
export function detect_duplicate_outflows(
  new_outflows: OutflowForPersistence[],
  existing_outflows: ExistingOutflowData[]
): DomainResult<DuplicateDetectionResult> {
  const result: DuplicateDetectionResult = {
    new_outflows: [],
    potential_duplicates: [],
  };

  for (const new_outflow of new_outflows) {
    // Skip if this exact Plaid stream already exists
    const exact_match = existing_outflows.find(
      (e) => e.plaid_stream_id === new_outflow.plaid_stream_id
    );

    if (exact_match) {
      // This is an update, not a new item - include in new_outflows for upsert
      result.new_outflows.push(new_outflow);
      continue;
    }

    // Check for similar existing outflows
    const potential_match = find_similar_outflow(new_outflow, existing_outflows);

    if (potential_match) {
      result.potential_duplicates.push({
        new_outflow,
        existing_outflow: potential_match.existing,
        confidence: potential_match.confidence,
        match_reason: potential_match.reason,
      });
    } else {
      result.new_outflows.push(new_outflow);
    }
  }

  return { entity: result };
}

/**
 * Finds a similar existing outflow for duplicate detection.
 *
 * PURE FUNCTION.
 */
function find_similar_outflow(
  new_outflow: OutflowForPersistence,
  existing_outflows: ExistingOutflowData[]
): { existing: ExistingOutflowData; confidence: "high" | "medium" | "low"; reason: string } | null {
  for (const existing of existing_outflows) {
    // Skip inactive items
    if (!existing.is_active) continue;

    // Skip Plaid items (we only want to match against manual items)
    if (existing.source === "plaid") continue;

    const match_result = calculate_outflow_match(new_outflow, existing);

    if (match_result.is_match) {
      return {
        existing,
        confidence: match_result.confidence,
        reason: match_result.reasons.join("; "),
      };
    }
  }

  return null;
}

/**
 * Calculates if two outflows are likely the same.
 *
 * PURE FUNCTION.
 */
function calculate_outflow_match(
  new_outflow: OutflowForPersistence,
  existing: ExistingOutflowData
): { is_match: boolean; confidence: "high" | "medium" | "low"; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Name matching (merchant)
  const name_match = names_match(
    new_outflow.merchant_name || new_outflow.description,
    existing.merchant_name || existing.description
  );
  if (name_match === "exact") {
    score += 3;
    reasons.push("exact merchant match");
  } else if (name_match === "similar") {
    score += 2;
    reasons.push("similar merchant name");
  }

  // Amount matching (within 20% tolerance)
  const amount_match = amounts_match(new_outflow.average_amount, existing.average_amount);
  if (amount_match === "exact") {
    score += 2;
    reasons.push("exact amount match");
  } else if (amount_match === "similar") {
    score += 1;
    reasons.push("similar amount (within 20%)");
  }

  // Frequency matching
  if (frequencies_compatible(new_outflow.frequency, existing.frequency)) {
    score += 2;
    reasons.push("compatible frequency");
  }

  // Determine match level
  if (score >= 6) {
    return { is_match: true, confidence: "high", reasons };
  } else if (score >= 4) {
    return { is_match: true, confidence: "medium", reasons };
  } else if (score >= 3 && reasons.length >= 2) {
    return { is_match: true, confidence: "low", reasons };
  }

  return { is_match: false, confidence: "low", reasons: [] };
}

// ============================================================================
// Merge Suggestions (PURE)
// ============================================================================

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
export function compute_outflow_merge_suggestions(
  plaid_outflows: OutflowForPersistence[],
  manual_outflows: ExistingOutflowData[]
): DomainResult<OutflowMergeSuggestion> {
  const suggestions: OutflowMergeSuggestion[] = [];

  // Only consider active manual outflows
  const active_manual = manual_outflows.filter(
    (m) => m.is_active && m.source === "manual"
  );

  for (const plaid_outflow of plaid_outflows) {
    for (const manual_outflow of active_manual) {
      const match_result = calculate_outflow_match(plaid_outflow, manual_outflow);

      if (match_result.is_match) {
        suggestions.push({
          plaid_outflow,
          manual_outflow,
          confidence: match_result.confidence,
          match_reasons: match_result.reasons,
          suggested_action: determine_merge_action(match_result.confidence),
        });
        break; // One suggestion per Plaid outflow
      }
    }
  }

  return { entities: suggestions };
}

/**
 * Determines the suggested action based on match confidence.
 *
 * PURE FUNCTION.
 */
function determine_merge_action(
  confidence: "high" | "medium" | "low"
): "merge" | "review" | "keep_separate" {
  switch (confidence) {
    case "high":
      return "merge";
    case "medium":
      return "review";
    case "low":
      return "keep_separate";
  }
}

// ============================================================================
// Helper Functions (PURE)
// ============================================================================

/**
 * Checks if two names match.
 *
 * PURE FUNCTION.
 */
function names_match(
  name1: string | null,
  name2: string | null
): "exact" | "similar" | "none" {
  if (!name1 || !name2) return "none";

  const normalized1 = normalize_name(name1);
  const normalized2 = normalize_name(name2);

  if (normalized1 === normalized2) {
    return "exact";
  }

  // Check if one contains the other (partial match)
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return "similar";
  }

  // Simple word overlap check
  const words1 = normalized1.split(/\s+/);
  const words2 = normalized2.split(/\s+/);
  const common_words = words1.filter((w) => words2.includes(w) && w.length > 2);

  if (common_words.length >= 1) {
    return "similar";
  }

  return "none";
}

/**
 * Normalizes a name for comparison.
 *
 * PURE FUNCTION.
 */
function normalize_name(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Checks if two amounts match within tolerance.
 *
 * PURE FUNCTION.
 */
function amounts_match(
  amount1: number,
  amount2: number
): "exact" | "similar" | "none" {
  if (amount1 === 0 && amount2 === 0) return "exact";
  if (amount1 === 0 || amount2 === 0) return "none";

  const diff = Math.abs(amount1 - amount2);
  const avg = (amount1 + amount2) / 2;
  const percentage_diff = diff / avg;

  if (percentage_diff < 0.01) {
    return "exact"; // Within 1%
  } else if (percentage_diff < 0.2) {
    return "similar"; // Within 20%
  }

  return "none";
}

/**
 * Checks if two frequencies are compatible.
 *
 * PURE FUNCTION.
 */
function frequencies_compatible(freq1: string, freq2: string): boolean {
  const normalized1 = freq1.toLowerCase();
  const normalized2 = freq2.toLowerCase();

  if (normalized1 === normalized2) return true;

  // Compatible frequency pairs
  const compatible_pairs: Array<[string, string]> = [
    ["biweekly", "semimonthly"], // Both ~2x per month
    ["weekly", "biweekly"], // Related cadences
  ];

  return compatible_pairs.some(
    ([a, b]) =>
      (normalized1 === a && normalized2 === b) ||
      (normalized1 === b && normalized2 === a)
  );
}

/**
 * Filters outflows to only those that need merge review.
 *
 * PURE FUNCTION.
 *
 * @param outflows - All outflows
 * @returns Outflows with pending_review status
 */
export function filter_outflows_needing_review(
  outflows: OutflowForPersistence[]
): OutflowForPersistence[] {
  return outflows.filter((o) => o.status === "pending_review");
}

/**
 * Computes the status for a new Plaid outflow.
 *
 * PURE FUNCTION.
 *
 * @param has_similar_manual - Whether a similar manual outflow exists
 * @param plaid_confidence - Plaid's confidence level
 * @returns Appropriate status for the outflow
 */
export function compute_outflow_status(
  has_similar_manual: boolean,
  plaid_confidence: string | null
): "active" | "pending_review" | "inactive" {
  if (has_similar_manual) {
    return "pending_review"; // User should confirm merge
  }

  if (plaid_confidence === "LOW" || plaid_confidence === "UNKNOWN") {
    return "pending_review";
  }

  return "pending_review"; // Per project decision: all new items start as pending_review
}

/**
 * Categorizes outflows by expense type for analysis.
 *
 * PURE FUNCTION.
 *
 * @param outflows - Outflows to categorize
 * @returns Map of expense type to outflows
 */
export function categorize_outflows_by_type(
  outflows: OutflowForPersistence[]
): Map<string, OutflowForPersistence[]> {
  const result = new Map<string, OutflowForPersistence[]>();

  for (const outflow of outflows) {
    const type = outflow.expense_type || "other";
    const existing = result.get(type) || [];
    existing.push(outflow);
    result.set(type, existing);
  }

  return result;
}

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
export function compute_monthly_outflow_total(
  outflows: OutflowForPersistence[]
): number {
  let total = 0;

  for (const outflow of outflows) {
    if (!outflow.is_active) continue;

    const monthly_amount = normalize_to_monthly(
      outflow.average_amount,
      outflow.frequency as AppFrequency
    );
    total += monthly_amount;
  }

  return Math.round(total * 100) / 100; // Round to cents
}

/**
 * Normalizes an amount to monthly equivalent based on frequency.
 *
 * PURE FUNCTION.
 */
function normalize_to_monthly(amount: number, frequency: AppFrequency): number {
  switch (frequency) {
    case "weekly":
      return amount * 4.33; // Average weeks per month
    case "biweekly":
      return amount * 2.17;
    case "semimonthly":
      return amount * 2;
    case "monthly":
      return amount;
    case "yearly":
      return amount / 12;
    case "unknown":
    default:
      return amount; // Assume monthly
  }
}
