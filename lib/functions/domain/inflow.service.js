"use strict";
/**
 * Inflow Domain Service
 *
 * Pure business logic for recurring income (inflow) operations.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/inflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_inflows_for_sync = validate_inflows_for_sync;
exports.detect_duplicate_inflows = detect_duplicate_inflows;
exports.compute_inflow_merge_suggestions = compute_inflow_merge_suggestions;
exports.filter_inflows_needing_review = filter_inflows_needing_review;
exports.compute_inflow_status = compute_inflow_status;
const types_1 = require("../types");
// ============================================================================
// Validation Functions (PURE)
// ============================================================================
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
function validate_inflows_for_sync(inflows) {
    const valid_inflows = [];
    const validation_errors = [];
    for (const inflow of inflows) {
        const errors = validate_single_inflow(inflow);
        if (errors.length === 0) {
            valid_inflows.push(inflow);
        }
        else {
            validation_errors.push(`Inflow ${inflow.id}: ${errors.join(", ")}`);
        }
    }
    if (validation_errors.length > 0) {
        return (0, types_1.partial_success)(valid_inflows, validation_errors);
    }
    return (0, types_1.success_many)(valid_inflows);
}
/**
 * Validates a single inflow.
 *
 * PURE FUNCTION.
 */
function validate_single_inflow(inflow) {
    const errors = [];
    // Required fields
    if (!inflow.id) {
        errors.push("missing id");
    }
    if (!inflow.owner_id) {
        errors.push("missing owner_id");
    }
    if (!inflow.plaid_item_id) {
        errors.push("missing plaid_item_id");
    }
    if (!inflow.account_id) {
        errors.push("missing account_id");
    }
    // Amount validation
    if (inflow.average_amount < 0) {
        errors.push("average_amount cannot be negative");
    }
    if (inflow.last_amount < 0) {
        errors.push("last_amount cannot be negative");
    }
    // Date validation
    if (inflow.first_date && inflow.last_date) {
        if (inflow.first_date > inflow.last_date) {
            errors.push("first_date cannot be after last_date");
        }
    }
    // Frequency validation
    const valid_frequencies = [
        "weekly", "biweekly", "semimonthly", "monthly", "yearly", "unknown"
    ];
    if (!valid_frequencies.includes(inflow.frequency)) {
        errors.push(`invalid frequency: ${inflow.frequency}`);
    }
    return errors;
}
// ============================================================================
// Duplicate Detection (PURE)
// ============================================================================
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
function detect_duplicate_inflows(new_inflows, existing_inflows) {
    const result = {
        new_inflows: [],
        potential_duplicates: [],
    };
    for (const new_inflow of new_inflows) {
        // Skip if this exact Plaid stream already exists
        const exact_match = existing_inflows.find((e) => e.plaid_stream_id === new_inflow.plaid_stream_id);
        if (exact_match) {
            // This is an update, not a new item - include in new_inflows for upsert
            result.new_inflows.push(new_inflow);
            continue;
        }
        // Check for similar existing inflows
        const potential_match = find_similar_inflow(new_inflow, existing_inflows);
        if (potential_match) {
            result.potential_duplicates.push({
                new_inflow,
                existing_inflow: potential_match.existing,
                confidence: potential_match.confidence,
                match_reason: potential_match.reason,
            });
        }
        else {
            result.new_inflows.push(new_inflow);
        }
    }
    return { entity: result };
}
/**
 * Finds a similar existing inflow for duplicate detection.
 *
 * PURE FUNCTION.
 */
function find_similar_inflow(new_inflow, existing_inflows) {
    for (const existing of existing_inflows) {
        // Skip inactive items
        if (!existing.is_active)
            continue;
        // Skip Plaid items (we only want to match against manual items)
        if (existing.source === "plaid")
            continue;
        const match_result = calculate_inflow_match(new_inflow, existing);
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
 * Calculates if two inflows are likely the same.
 *
 * PURE FUNCTION.
 */
function calculate_inflow_match(new_inflow, existing) {
    const reasons = [];
    let score = 0;
    // Name matching (merchant/payer)
    const name_match = names_match(new_inflow.payer_name || new_inflow.description, existing.payer_name || existing.description);
    if (name_match === "exact") {
        score += 3;
        reasons.push("exact name match");
    }
    else if (name_match === "similar") {
        score += 2;
        reasons.push("similar name");
    }
    // Amount matching (within 20% tolerance)
    const amount_match = amounts_match(new_inflow.average_amount, existing.average_amount);
    if (amount_match === "exact") {
        score += 2;
        reasons.push("exact amount match");
    }
    else if (amount_match === "similar") {
        score += 1;
        reasons.push("similar amount (within 20%)");
    }
    // Frequency matching
    if (frequencies_compatible(new_inflow.frequency, existing.frequency)) {
        score += 2;
        reasons.push("compatible frequency");
    }
    // Determine match level
    if (score >= 6) {
        return { is_match: true, confidence: "high", reasons };
    }
    else if (score >= 4) {
        return { is_match: true, confidence: "medium", reasons };
    }
    else if (score >= 3 && reasons.length >= 2) {
        return { is_match: true, confidence: "low", reasons };
    }
    return { is_match: false, confidence: "low", reasons: [] };
}
// ============================================================================
// Merge Suggestions (PURE)
// ============================================================================
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
function compute_inflow_merge_suggestions(plaid_inflows, manual_inflows) {
    const suggestions = [];
    // Only consider active manual inflows
    const active_manual = manual_inflows.filter((m) => m.is_active && m.source === "manual");
    for (const plaid_inflow of plaid_inflows) {
        for (const manual_inflow of active_manual) {
            const match_result = calculate_inflow_match(plaid_inflow, manual_inflow);
            if (match_result.is_match) {
                suggestions.push({
                    plaid_inflow,
                    manual_inflow,
                    confidence: match_result.confidence,
                    match_reasons: match_result.reasons,
                    suggested_action: determine_merge_action(match_result.confidence),
                });
                break; // One suggestion per Plaid inflow
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
function determine_merge_action(confidence) {
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
function names_match(name1, name2) {
    if (!name1 || !name2)
        return "none";
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
function normalize_name(name) {
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
function amounts_match(amount1, amount2) {
    if (amount1 === 0 && amount2 === 0)
        return "exact";
    if (amount1 === 0 || amount2 === 0)
        return "none";
    const diff = Math.abs(amount1 - amount2);
    const avg = (amount1 + amount2) / 2;
    const percentage_diff = diff / avg;
    if (percentage_diff < 0.01) {
        return "exact"; // Within 1%
    }
    else if (percentage_diff < 0.2) {
        return "similar"; // Within 20%
    }
    return "none";
}
/**
 * Checks if two frequencies are compatible.
 *
 * PURE FUNCTION.
 */
function frequencies_compatible(freq1, freq2) {
    const normalized1 = freq1.toLowerCase();
    const normalized2 = freq2.toLowerCase();
    if (normalized1 === normalized2)
        return true;
    // Compatible frequency pairs
    const compatible_pairs = [
        ["biweekly", "semimonthly"], // Both ~2x per month
        ["weekly", "biweekly"], // Related cadences
    ];
    return compatible_pairs.some(([a, b]) => (normalized1 === a && normalized2 === b) ||
        (normalized1 === b && normalized2 === a));
}
/**
 * Filters inflows to only those that need merge review.
 *
 * PURE FUNCTION.
 *
 * @param inflows - All inflows
 * @returns Inflows with pending_review status
 */
function filter_inflows_needing_review(inflows) {
    return inflows.filter((i) => i.status === "pending_review");
}
/**
 * Computes the status for a new Plaid inflow.
 *
 * PURE FUNCTION.
 *
 * @param has_similar_manual - Whether a similar manual inflow exists
 * @param plaid_confidence - Plaid's confidence level
 * @returns Appropriate status for the inflow
 */
function compute_inflow_status(has_similar_manual, plaid_confidence) {
    if (has_similar_manual) {
        return "pending_review"; // User should confirm merge
    }
    if (plaid_confidence === "LOW" || plaid_confidence === "UNKNOWN") {
        return "pending_review";
    }
    return "pending_review"; // Per project decision: all new items start as pending_review
}
//# sourceMappingURL=inflow.service.js.map