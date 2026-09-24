"use strict";
/**
 * Reconcile User Recurring (debounced batch) Orchestrator
 *
 * Collapses the per-recurring reconcile fan-out (TR-3). Creating a recurring item used to
 * enqueue TWO durable jobs — `assign_recurring_transactions` + `reconcile_recurring_period`
 * — PER item, so a bulk import (or a Plaid recurring sync writing N streams) fanned out to
 * ~2N jobs + 2N `on_job_created` invocations, each re-resolving context.
 *
 * Instead, `on_{outflow,inflow}_created` now enqueues ONE debounced job per user (dedup
 * `reconcile_user_recurring:{uid}`). This job reads the user's watermark, finds every active
 * recurring (outflow + inflow) updated since it that has linked transactions, then: (1) runs
 * ONE `assign_transactions_batch` over the UNION of all dirty streams' transactions — a single
 * candidate preload instead of one per bill (the #1 read line); (2) reconciles each stream's
 * own periods. So N streams cost 1 job + 1 assignment scan. Counts are small (tens), no paging.
 *
 * Watermark advances to the max `updatedAt` of the items processed (never past an unprocessed
 * row). Per-item failures are caught + logged (a single poison stream must not strand the
 * rest); reconcile/assign are idempotent, so a re-run is safe.
 *
 * @module orchestrators/recurring/reconcile_user_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcile_user_recurring_orchestrator = reconcile_user_recurring_orchestrator;
const observability_1 = require("../../observability");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const recurring_reconcile_watermark_repo_1 = require("../../repositories/recurring_reconcile_watermark.repo");
const assign_transactions_batch_orchestrator_1 = require("../transactions/assign_transactions_batch.orchestrator");
const reconcile_recurring_periods_orchestrator_1 = require("./reconcile_recurring_periods.orchestrator");
/** First-run lookback when no watermark exists — bounds the very first pass. */
const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** How many recurring items to reconcile concurrently. */
const CONCURRENCY = 5;
async function reconcile_user_recurring_orchestrator(ctx, input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "reconcile_user_recurring");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        const watermark_ms = (_a = (await (0, recurring_reconcile_watermark_repo_1.get_recurring_reconcile_watermark_ms)(input.user_id))) !== null && _a !== void 0 ? _a : Date.now() - INITIAL_LOOKBACK_MS;
        // Read the user's active recurring ONCE (outflows + inflows). Counts are small.
        const [outflows, inflows] = await Promise.all([
            outflow_repo_1.outflow_repo.get_by_user_id(ctx, input.user_id),
            inflow_repo_1.inflow_repo.get_by_user_id(ctx, input.user_id),
        ]);
        // Dirty = updated since the watermark AND has linked transactions (mirrors the old
        // trigger guard — a stream with no txns has nothing to assign/reconcile).
        const dirty = [];
        for (const o of outflows) {
            const ms = (_d = (_c = (_b = o.updated_at) === null || _b === void 0 ? void 0 : _b.toMillis) === null || _c === void 0 ? void 0 : _c.call(_b)) !== null && _d !== void 0 ? _d : 0;
            if (ms > watermark_ms && ((_f = (_e = o.transaction_ids) === null || _e === void 0 ? void 0 : _e.length) !== null && _f !== void 0 ? _f : 0) > 0) {
                dirty.push({
                    id: o.id, type: "outflow", updated_ms: ms, plaid_ids: (_g = o.transaction_ids) !== null && _g !== void 0 ? _g : [],
                });
            }
        }
        for (const i of inflows) {
            const ms = (_k = (_j = (_h = i.updated_at) === null || _h === void 0 ? void 0 : _h.toMillis) === null || _j === void 0 ? void 0 : _j.call(_h)) !== null && _k !== void 0 ? _k : 0;
            if (ms > watermark_ms && ((_m = (_l = i.transaction_ids) === null || _l === void 0 ? void 0 : _l.length) !== null && _m !== void 0 ? _m : 0) > 0) {
                dirty.push({
                    id: i.id, type: "inflow", updated_ms: ms, plaid_ids: (_o = i.transaction_ids) !== null && _o !== void 0 ? _o : [],
                });
            }
        }
        if (dirty.length === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { reconciled: 0 };
        }
        // (1) ASSIGN once for the UNION of all dirty streams' transactions (TR-3 read fix).
        // Previously this looped `assign_recurring_transactions` per bill, and EACH call ran an
        // `assign_transactions_batch` whose candidate preload scans ALL of the user's
        // outflow_periods in the date span (~1.6K docs) — so M dirty bills = M full scans (the
        // #1 read line). Resolving the union of Plaid ids ONCE and running a SINGLE batch
        // collapses that to one candidate preload. The batch's per-split engine still links each
        // txn to its own matched stream, so correctness is unchanged.
        const union_plaid_ids = Array.from(new Set(dirty.flatMap((d) => d.plaid_ids)));
        if (union_plaid_ids.length > 0) {
            const txns = await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, input.user_id, union_plaid_ids);
            const doc_ids = txns.filter((t) => t.isActive !== false).map((t) => t.id);
            if (doc_ids.length > 0) {
                // Scope the candidate preload to just the dirty streams (read-cost #1): these txns ARE
                // those streams' membership, so the engine needs only their periods — not ALL the user's.
                await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
                    user_id: input.user_id,
                    transaction_ids: doc_ids,
                    candidate_outflow_ids: dirty.filter((d) => d.type === "outflow").map((d) => d.id),
                    candidate_inflow_ids: dirty.filter((d) => d.type === "inflow").map((d) => d.id),
                });
            }
        }
        // (2) RECONCILE each dirty stream's periods. This reads only that stream's OWN periods
        // (by outflowId/inflowId), NOT the user-wide candidate window — so it is not the #1 line.
        // Best-effort per item so one failure doesn't strand the rest.
        let reconciled = 0;
        const process_one = async (d) => {
            try {
                await (0, reconcile_recurring_periods_orchestrator_1.reconcile_recurring_periods_orchestrator)(ctx, {
                    recurring_id: d.id,
                    recurring_type: d.type,
                    user_id: input.user_id,
                    trace_id: ctx.trace_id,
                });
                reconciled++;
            }
            catch (error) {
                console.error(`[${ctx.trace_id}] reconcile_user_recurring: ${d.type} ${d.id} failed`, error);
            }
        };
        for (let k = 0; k < dirty.length; k += CONCURRENCY) {
            await Promise.all(dirty.slice(k, k + CONCURRENCY).map(process_one));
        }
        // Advance to the max updatedAt among the items we looked at — never past an unprocessed
        // row (a stream created mid-run has a newer updatedAt and is caught by its own trigger).
        const max_ms = Math.max(...dirty.map((d) => d.updated_ms));
        await (0, recurring_reconcile_watermark_repo_1.set_recurring_reconcile_watermark_ms)(input.user_id, max_ms);
        console.log(`[${ctx.trace_id}] reconcile_user_recurring: user=${input.user_id} ` +
            `dirty=${dirty.length} reconciled=${reconciled} ` +
            `watermark=${new Date(max_ms).toISOString()}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { reconciled };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "RECONCILE_USER_RECURRING_FAILED" });
        throw error; // let the job queue retry from the un-advanced watermark
    }
}
//# sourceMappingURL=reconcile_user_recurring.orchestrator.js.map