"use strict";
/**
 * Initial Sync Domain Service
 *
 * Pure validation and computation functions for the initial sync.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/initial_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_initial_sync = validate_initial_sync;
exports.should_continue_after_failure = should_continue_after_failure;
exports.aggregate_sync_results = aggregate_sync_results;
exports.create_success_phase_result = create_success_phase_result;
exports.create_failure_phase_result = create_failure_phase_result;
/**
 * Validates that the initial sync can proceed.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Validation input
 * @returns Domain result with validation errors if any
 */
function validate_initial_sync(input) {
    const validation_errors = [];
    // Validate required fields
    if (!input.plaid_item_id) {
        validation_errors.push("Missing plaid_item_id");
    }
    if (!input.user_id) {
        validation_errors.push("Missing user_id");
    }
    // Validate item exists
    if (!input.item_exists) {
        validation_errors.push("Plaid item does not exist or is not active");
    }
    // Validate access token present
    if (!input.has_access_token) {
        validation_errors.push("Plaid item has no access token");
    }
    if (validation_errors.length > 0) {
        return { validation_errors };
    }
    return { entity: { valid: true } };
}
/**
 * Determines if sync should continue after a phase failure.
 *
 * PURE FUNCTION.
 *
 * We continue after account failures because transactions might still sync.
 * We continue after transaction failures because recurring might still sync.
 * Each phase is independent enough to proceed.
 *
 * @param phase - The phase that failed
 * @param error_message - The error message
 * @returns Whether to continue with remaining phases
 */
function should_continue_after_failure(phase, error_message) {
    // Critical errors that should halt everything
    const critical_patterns = [
        "ITEM_LOGIN_REQUIRED",
        "ITEM_NOT_FOUND",
        "ACCESS_NOT_GRANTED",
        "INVALID_ACCESS_TOKEN",
    ];
    for (const pattern of critical_patterns) {
        if (error_message.includes(pattern)) {
            return false;
        }
    }
    // For non-critical errors, continue with remaining phases
    return true;
}
/**
 * Aggregates phase results into the final orchestrator result.
 *
 * PURE FUNCTION.
 *
 * @param phases - Results from each phase
 * @param start_time - When the sync started (for duration calc)
 * @param end_time - When the sync ended
 * @returns Final orchestrator result
 */
function aggregate_sync_results(phases, start_time, end_time) {
    var _a, _b;
    const errors = [];
    // Initialize counters
    let accounts_created = 0;
    let transactions_added = 0;
    let transactions_modified = 0;
    let transactions_removed = 0;
    let inflows_created = 0;
    let inflows_updated = 0;
    let outflows_created = 0;
    let outflows_updated = 0;
    // Aggregate from each phase
    for (const phase of phases) {
        if (!phase.success && phase.error_message) {
            errors.push(`${phase.phase}: ${phase.error_message}`);
        }
        switch (phase.phase) {
            case "accounts":
                accounts_created = phase.counts.created;
                break;
            case "transactions":
                transactions_added = phase.counts.created;
                transactions_modified = phase.counts.updated;
                transactions_removed = (_a = phase.counts.removed) !== null && _a !== void 0 ? _a : 0;
                break;
            case "recurring":
                // Recurring phase creates both inflows and outflows
                // The counts are combined in the phase result
                // We split them based on whether they're positive or negative amounts
                // For now, we estimate 50/50 split - this will be refined when we have actual data
                inflows_created = Math.floor(phase.counts.created / 2);
                inflows_updated = Math.floor(phase.counts.updated / 2);
                outflows_created = phase.counts.created - inflows_created;
                outflows_updated = phase.counts.updated - inflows_updated;
                break;
        }
    }
    // Determine overall success
    // Success if at least accounts phase succeeded (core requirement)
    const accounts_phase = phases.find(p => p.phase === "accounts");
    const success = (_b = accounts_phase === null || accounts_phase === void 0 ? void 0 : accounts_phase.success) !== null && _b !== void 0 ? _b : false;
    return {
        success,
        phases,
        summary: {
            accounts_created,
            transactions_added,
            transactions_modified,
            transactions_removed,
            inflows_created,
            inflows_updated,
            outflows_created,
            outflows_updated,
            total_duration_ms: end_time - start_time,
        },
        errors: errors.length > 0 ? errors : undefined,
    };
}
/**
 * Creates a phase result for a successful phase.
 *
 * PURE FUNCTION.
 */
function create_success_phase_result(phase, counts, duration_ms) {
    return {
        phase,
        success: true,
        counts: {
            created: counts.created,
            updated: counts.updated,
            removed: counts.removed,
            errors: 0,
        },
        duration_ms,
    };
}
/**
 * Creates a phase result for a failed phase.
 *
 * PURE FUNCTION.
 */
function create_failure_phase_result(phase, error_message, duration_ms) {
    return {
        phase,
        success: false,
        counts: {
            created: 0,
            updated: 0,
            removed: 0,
            errors: 1,
        },
        error_message,
        duration_ms,
    };
}
//# sourceMappingURL=initial_sync.service.js.map