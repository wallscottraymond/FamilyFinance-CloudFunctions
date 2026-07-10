"use strict";
/**
 * Recompute Budget Rollover Orchestrator
 *
 * The real-time half of the rollover system (the other half is the 3 AM
 * `calculateDailyRollover` catch-up). When the spend pipeline changes a budget's
 * `spent`, that budget's rollover chain becomes invalid — each period's
 * `rolledOverAmount` derives from the previous period's `allocated + rollover −
 * spent`. This orchestrator recomputes the chain and refreshes the summaries the
 * app renders.
 *
 * Dispatched from the `_jobs` queue as `recalculate_rollover`, enqueued by
 * `recompute_budget_spent` ONLY for budgets with `rolloverEnabled` (see there).
 *
 * Loop-safety: the chain writes `rolledOverAmount`/`remaining` but NEVER `spent`,
 * and rollover jobs are enqueued solely from the spend pipeline (driven by
 * transaction writes) — so a rollover write cannot re-enter the spend pipeline
 * or re-enqueue itself.
 *
 * NOTE (legacy coupling): the chain math + its period query/writes live in the
 * legacy `budgets/utils/rolloverChainCalculation` (owns its own reads/writes,
 * like a scoped repo). This orchestrator delegates to it — the same pattern
 * `process_budget_period_edited` uses for the sync utils.
 *
 * @module orchestrators/budgets/recompute_budget_rollover
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recompute_budget_rollover_orchestrator = recompute_budget_rollover_orchestrator;
const admin = __importStar(require("firebase-admin"));
const observability_1 = require("../../observability");
const rolloverChainCalculation_1 = require("../../budgets/utils/rolloverChainCalculation");
const summaries_1 = require("../summaries");
/**
 * Recompute the rollover chain for one budget, then refresh the affected
 * summaries.
 *
 * @returns Count of periods whose rollover/remaining changed.
 */
async function recompute_budget_rollover_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "recompute_budget_rollover");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        const db = admin.firestore();
        const result = await (0, rolloverChainCalculation_1.recalculateRolloverChain)(db, input.budget_id, input.start_from_period_id);
        if (!result.success) {
            // Surface as a throw so the job queue retries / DLQs it.
            throw new Error(`rollover chain failed for budget ${input.budget_id}: ${result.errors.join("; ")}`);
        }
        // Refresh only the summaries whose periods actually changed.
        if (result.updatedPeriodIds.length > 0) {
            try {
                await (0, summaries_1.enqueue_user_summary_updates_from_budget_periods)(ctx, input.user_id, result.updatedPeriodIds);
            }
            catch (summary_error) {
                console.error(`[${ctx.trace_id}] recompute_budget_rollover: summary update failed (non-fatal):`, summary_error);
            }
        }
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { periods_updated: result.periodsUpdated };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "RECOMPUTE_BUDGET_ROLLOVER_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=recompute_budget_rollover.orchestrator.js.map