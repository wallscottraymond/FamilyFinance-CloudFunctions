/**
 * Initial Sync Domain Service
 *
 * Pure validation and computation functions for the initial sync.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/initial_sync
 */
import { DomainResult } from "../../types";
import { InitialSyncValidationInput, SyncPhaseResult, InitialSyncOrchestratorResult } from "../../types/plaid";
/**
 * Validates that the initial sync can proceed.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Validation input
 * @returns Domain result with validation errors if any
 */
export declare function validate_initial_sync(input: InitialSyncValidationInput): DomainResult<{
    valid: true;
}>;
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
export declare function should_continue_after_failure(phase: "accounts" | "transactions" | "recurring", error_message: string): boolean;
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
export declare function aggregate_sync_results(phases: SyncPhaseResult[], start_time: number, end_time: number): InitialSyncOrchestratorResult;
/**
 * Creates a phase result for a successful phase.
 *
 * PURE FUNCTION.
 */
export declare function create_success_phase_result(phase: "accounts" | "transactions" | "recurring", counts: {
    created: number;
    updated: number;
    removed?: number;
}, duration_ms: number): SyncPhaseResult;
/**
 * Creates a phase result for a failed phase.
 *
 * PURE FUNCTION.
 */
export declare function create_failure_phase_result(phase: "accounts" | "transactions" | "recurring", error_message: string, duration_ms: number): SyncPhaseResult;
//# sourceMappingURL=initial_sync.service.d.ts.map