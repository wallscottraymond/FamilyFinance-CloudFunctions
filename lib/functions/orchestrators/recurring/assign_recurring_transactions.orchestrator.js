"use strict";
/**
 * Assign Recurring Transactions Orchestrator
 * (the `assign_recurring_transactions` job body)
 *
 * When a recurring item (outflow/inflow) is newly created, its historical
 * transactions were synced + assigned BEFORE the item (and its periods) existed,
 * so their splits never got `outflowId`/`inflowId` set — which budget
 * recurring-exclusion depends on. This job re-runs the assignment engine for the
 * item's transactions so those links are set now that the periods exist.
 *
 * Thin: load the recurring doc's `transactionIds` (Plaid ids) → resolve to
 * Firestore doc ids → delegate to the existing `assign_transactions_batch`
 * orchestrator (which sets the recurring link per split and fans out the
 * reconcile + budget recompute).
 *
 * @module orchestrators/recurring/assign_recurring_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_recurring_transactions_orchestrator = assign_recurring_transactions_orchestrator;
const observability_1 = require("../../observability");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const assign_transactions_batch_orchestrator_1 = require("../transactions/assign_transactions_batch.orchestrator");
async function assign_recurring_transactions_orchestrator(ctx, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "assign_recurring_transactions");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        // 1. Recurring doc → its Plaid transaction ids (the stream's membership).
        const recurring = input.recurring_type === "outflow"
            ? await outflow_repo_1.outflow_repo.get_by_id(ctx, input.recurring_id)
            : await inflow_repo_1.inflow_repo.get_by_id(ctx, input.recurring_id);
        const plaid_ids = (_a = recurring === null || recurring === void 0 ? void 0 : recurring.transaction_ids) !== null && _a !== void 0 ? _a : [];
        if (plaid_ids.length === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { transactions_assigned: 0, success: true };
        }
        // 2. Resolve Plaid ids → active Firestore transaction doc ids.
        const txns = await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, input.user_id, plaid_ids);
        const doc_ids = txns.filter((t) => t.isActive !== false).map((t) => t.id);
        if (doc_ids.length === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { transactions_assigned: 0, success: true };
        }
        // 3. Re-run the engine for those transactions (sets the recurring link per
        //    split; the engine fans out reconcile + budget recompute for touched docs).
        await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
            user_id: input.user_id,
            transaction_ids: doc_ids,
        });
        console.log(`[${ctx.trace_id}] assign_recurring_transactions: ${input.recurring_type}=${input.recurring_id}, ` +
            `transactions=${doc_ids.length}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { transactions_assigned: doc_ids.length, success: true };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "ASSIGN_RECURRING_TRANSACTIONS_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=assign_recurring_transactions.orchestrator.js.map