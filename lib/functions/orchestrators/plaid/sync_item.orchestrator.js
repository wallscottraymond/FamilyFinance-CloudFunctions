"use strict";
/**
 * Sync Item Orchestrator — THE way a Plaid item is synced (first link, webhooks, crons, manual
 * refresh, re-auth). One writer per item, one write per transaction, one follow-up pass.
 *
 *   1. Lease: at most one sync per item; a request during a sync makes the holder run again.
 *   2. Bills / income FIRST (when Plaid has them and they're due), so the assignment engine's
 *      authoritative stream membership is in place before any transaction is written.
 *   3. Transactions: every page pulled, assigned IN MEMORY, written ONCE (`syncRunId` stamped —
 *      the per-transaction trigger skips them).
 *   4. New streams: their periods generated inline (the create trigger skips sync-stamped
 *      streams), and transactions written BEFORE their stream existed are linked once.
 *   5. ONE follow-up pass: reconcile affected bills/income, recompute affected budget periods,
 *      re-check internal transfers, bump the derive version once.
 *
 * Replaces, for a first link: the bare transaction write + read-back + re-write, ~650
 * recompute-per-day jobs, ~3 reconciles per stream, and a chain of 5-minute sweep waits.
 *
 * @module orchestrators/plaid/sync_item
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueue_item_sync = enqueue_item_sync;
exports.sync_item_orchestrator = sync_item_orchestrator;
const observability_1 = require("../../observability");
const item_sync_lease_repo_1 = require("../../repositories/plaid/item_sync_lease.repo");
const plaid_1 = require("../../repositories/plaid");
const repositories_1 = require("../../repositories");
const purge_guard_1 = require("../../infrastructure/purge_guard");
const job_queue_1 = require("../../infrastructure/job_queue");
const sync_transactions_orchestrator_1 = require("./sync_transactions.orchestrator");
const sync_recurring_orchestrator_1 = require("./sync_recurring.orchestrator");
const save_item_accounts_1 = require("./save_item_accounts");
const sync_follow_ups_1 = require("./sync_follow_ups");
const assign_transactions_batch_orchestrator_1 = require("../transactions/assign_transactions_batch.orchestrator");
const generate_periods_inline_1 = require("../recurring/generate_periods_inline");
/** Plaid's first pull isn't ready: try again on this schedule (webhooks usually beat it). */
const NOT_READY_RETRY_SECONDS = 60;
const MAX_NOT_READY_ATTEMPTS = 10;
const MAX_ROUNDS = 3;
/** Enqueue a sync for an item — every entry point uses this (webhook, link, cron, retry). */
async function enqueue_item_sync(input) {
    var _a, _b, _c;
    await (0, job_queue_1.coalesce_job)("sync_item", {
        deduplication_key: `sync_item:${input.item_doc_id}`,
        item_doc_id: input.item_doc_id,
        user_id: input.user_id,
        recurring: !!input.recurring,
        attempt: (_a = input.attempt) !== null && _a !== void 0 ? _a : 1,
        reason: (_b = input.reason) !== null && _b !== void 0 ? _b : "request",
    }, {
        // No delay → `on_job_created` runs it immediately (delayed jobs wait for the 5-min sweep).
        delay_seconds: (_c = input.delay_seconds) !== null && _c !== void 0 ? _c : 0,
        trace_id: input.trace_id,
        // A recurring request never merges into a pending NON-recurring run (it would drop the
        // recurring refresh — e.g. "Track" on a review item would never create the bill). Anything
        // else merges as before. A deliberate change for all users (D30, approved 2026-10-16): at
        // most one extra sync in a burst.
        can_merge_into: async (pending) => !!pending.recurring || !input.recurring,
    });
}
async function sync_item_orchestrator(ctx, input) {
    const run_id = ctx.trace_id;
    const result = {
        status: "synced",
        rounds: 0,
        added: 0,
        modified: 0,
        removed: 0,
        streams_written: 0,
    };
    if (await (0, purge_guard_1.is_user_purging)(input.user_id)) {
        return Object.assign(Object.assign({}, result), { status: "skipped", error: "user being deleted" });
    }
    if (!(await item_sync_lease_repo_1.item_sync_lease_repo.claim(input.item_doc_id, run_id, { recurring: input.recurring }))) {
        console.log(`[${ctx.trace_id}] sync_item: ${input.item_doc_id} already syncing — it will run again`);
        return Object.assign(Object.assign({}, result), { status: "already_running" });
    }
    let request = { recurring: input.recurring };
    try {
        while (request && result.rounds < MAX_ROUNDS) {
            result.rounds++;
            await run_round(ctx, input, run_id, request, result);
            request = await item_sync_lease_repo_1.item_sync_lease_repo.finish_round(input.item_doc_id, run_id);
        }
        if (request) {
            // Still being asked after MAX_ROUNDS — hand the rest to a fresh job.
            await item_sync_lease_repo_1.item_sync_lease_repo.release(input.item_doc_id, run_id);
            await enqueue_item_sync(Object.assign(Object.assign({}, input), { recurring: request.recurring, reason: "more_requests", trace_id: ctx.trace_id }));
        }
        return result;
    }
    catch (error) {
        await item_sync_lease_repo_1.item_sync_lease_repo.release(input.item_doc_id, run_id).catch(() => { });
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[${ctx.trace_id}] sync_item failed for ${input.item_doc_id}:`, msg);
        throw error; // the job queue retries
    }
}
async function run_round(ctx, input, run_id, request, result) {
    var _a;
    const item = await plaid_1.plaid_item_repo.get_raw_by_id(ctx, input.item_doc_id);
    if (!item || item.data.isActive === false) {
        result.status = "skipped";
        return;
    }
    const never_synced_recurring = !item.data.lastRecurringSyncAt;
    let follow_ups = (0, sync_follow_ups_1.empty_follow_ups)();
    const streams_written = [];
    const newly_suppressed = new Set();
    const newly_absorbed = new Set();
    const absorbing = new Map();
    const sync_recurring = async () => {
        var _a, _b, _c, _d;
        const r = await (0, sync_recurring_orchestrator_1.sync_recurring_orchestrator)(Object.assign(Object.assign({}, (0, observability_1.create_child_span)(ctx)), { input: { item_id: input.item_doc_id }, user_id: input.user_id, idempotency_key: `sync_item:${run_id}:recurring` }), { run_id });
        streams_written.push(...r.written);
        for (const id of (_a = r.newly_suppressed_plaid_ids) !== null && _a !== void 0 ? _a : [])
            newly_suppressed.add(id);
        for (const id of (_b = r.newly_absorbed_plaid_ids) !== null && _b !== void 0 ? _b : [])
            newly_absorbed.add(id);
        for (const a of (_c = r.absorbing_records) !== null && _c !== void 0 ? _c : [])
            absorbing.set(a.id, a.direction);
        // A "Track" whose stream is gone from this item was handed to the user's other items (round 4
        // defect 2): re-sync them now so one with a live stream of the vendor creates the bill.
        for (const other of (_d = r.handoff_item_doc_ids) !== null && _d !== void 0 ? _d : []) {
            await enqueue_item_sync({
                item_doc_id: other, user_id: input.user_id, recurring: true, reason: "track_handoff", trace_id: ctx.trace_id,
            }).catch((e) => console.warn(`[${ctx.trace_id}] track hand-off sync of ${other} not enqueued:`, e));
        }
        // A brand-new item's recurring data often isn't ready yet (PRODUCT_NOT_READY) — not an error.
        return r.success !== false;
    };
    // 1. Bills / income first when asked for (webhook) or never done — so stream membership is in
    //    the assignment context before transactions are written.
    let recurring_done = false;
    if (request.recurring || never_synced_recurring) {
        recurring_done = await sync_recurring();
    }
    // 2. Transactions — pulled, assigned in memory, written once.
    const tx_ctx = Object.assign(Object.assign({}, (0, observability_1.create_child_span)(ctx)), { input: { item_id: input.item_doc_id, user_id: input.user_id }, user_id: input.user_id, idempotency_key: `sync_item:${run_id}:transactions` });
    let tx = await (0, sync_transactions_orchestrator_1.sync_transactions_orchestrator)(tx_ctx, { run_id, defer_follow_ups: true });
    if (tx.needs_accounts) {
        // An account in this pull isn't saved yet (nothing was written): save the item's accounts
        // and pull again — no transaction is ever dropped for a missing account. Bills fetched above
        // skipped that account's streams, so fetch them again first (still before any transaction
        // is written, so the new account's bill payments are linked on their first write too).
        await (0, save_item_accounts_1.save_item_accounts)(ctx, item.id, item.data, input.user_id);
        if (request.recurring || never_synced_recurring) {
            recurring_done = await sync_recurring();
        }
        tx = await (0, sync_transactions_orchestrator_1.sync_transactions_orchestrator)(tx_ctx, { run_id, defer_follow_ups: true });
    }
    result.added += tx.added_count;
    result.modified += tx.modified_count;
    result.removed += tx.removed_count;
    follow_ups = (0, sync_follow_ups_1.merge_follow_ups)(follow_ups, tx.follow_ups);
    // 3. History just finished and bills were never fetched → fetch them now (Plaid detects
    //    recurring from the full history).
    if (!recurring_done && never_synced_recurring && tx.update_status === "HISTORICAL_UPDATE_COMPLETE") {
        recurring_done = await sync_recurring();
    }
    // 4. New / changed streams: generate periods for new ones inline, link transactions written
    //    before their stream existed, and reconcile them in the follow-up pass.
    if (streams_written.length > 0) {
        result.streams_written += streams_written.length;
        await (0, generate_periods_inline_1.generate_periods_inline)(ctx, input.user_id, streams_written.filter((s) => s.created));
        const relinked = await link_existing_transactions(ctx, input.user_id, run_id, streams_written);
        follow_ups = (0, sync_follow_ups_1.merge_follow_ups)(follow_ups, Object.assign(Object.assign({}, (0, sync_follow_ups_1.follow_ups_from_written)(relinked)), { outflow_ids: streams_written.filter((s) => is_outflow(s)).map((s) => s.id), inflow_ids: streams_written.filter((s) => !is_outflow(s)).map((s) => s.id), recurring_changed: true }));
    }
    // 4b. Payments newly held out of fuzzy bill matching (a suggested / skipped new stream, X3):
    //     re-assign the ones already stored so a merchant guess linking them to an OLD bill is
    //     cleared now (the engine reads the held-out set). Usually none.
    if (newly_suppressed.size > 0) {
        const relinked = await assign_by_plaid_ids(ctx, input.user_id, run_id, [...newly_suppressed]);
        follow_ups = (0, sync_follow_ups_1.merge_follow_ups)(follow_ups, (0, sync_follow_ups_1.follow_ups_from_written)(relinked));
    }
    // 4c. Payments a converted record just absorbed (D42): re-assign the stored ones so the engine's
    //     stream map links them now, and reconcile the absorbing records in the follow-up pass.
    if (newly_absorbed.size > 0) {
        const relinked = await assign_by_plaid_ids(ctx, input.user_id, run_id, [...newly_absorbed]);
        follow_ups = (0, sync_follow_ups_1.merge_follow_ups)(follow_ups, Object.assign(Object.assign({}, (0, sync_follow_ups_1.follow_ups_from_written)(relinked)), { outflow_ids: [...absorbing].filter(([, d]) => d === "outflow").map(([id]) => id), inflow_ids: [...absorbing].filter(([, d]) => d === "inflow").map(([id]) => id) }));
    }
    // 5. ONE follow-up pass for everything this round wrote.
    if (follow_ups.transactions_changed || follow_ups.recurring_changed) {
        await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, input.user_id, follow_ups);
    }
    // 6. Plaid's first pull not ready yet → try again shortly (its webhook usually arrives first).
    if (tx.success && tx.update_status === "NOT_READY") {
        const attempt = ((_a = input.attempt) !== null && _a !== void 0 ? _a : 1) + 1;
        if (attempt <= MAX_NOT_READY_ATTEMPTS) {
            await enqueue_item_sync({
                item_doc_id: input.item_doc_id,
                user_id: input.user_id,
                recurring: !recurring_done,
                delay_seconds: NOT_READY_RETRY_SECONDS,
                attempt,
                reason: "not_ready",
                trace_id: ctx.trace_id,
            });
        }
    }
    if (!tx.success && !tx.needs_accounts) {
        result.status = "failed";
        result.error = tx.error;
    }
}
const is_outflow = (s) => s.kind === "outflow";
/**
 * Transactions a NEW or changed stream claims that may have been written before it existed (an
 * earlier round, or before Plaid finished detecting recurring) — link them once. Ones already
 * linked are left alone (the engine finds nothing to change).
 */
async function link_existing_transactions(ctx, user_id, run_id, streams) {
    var _a;
    const before_ids = (s) => { var _a, _b; return new Set((_b = (_a = s.before) === null || _a === void 0 ? void 0 : _a.transactionIds) !== null && _b !== void 0 ? _b : []); };
    const plaid_ids = new Set();
    for (const s of streams) {
        const had = before_ids(s);
        for (const id of (_a = s.after.transactionIds) !== null && _a !== void 0 ? _a : []) {
            if (!had.has(id))
                plaid_ids.add(id);
        }
    }
    return assign_by_plaid_ids(ctx, user_id, run_id, [...plaid_ids]);
}
/** Re-assign the user's stored transactions with these Plaid ids in one batch (stamped run). */
async function assign_by_plaid_ids(ctx, user_id, run_id, ids) {
    if (ids.length === 0)
        return [];
    const docs = await repositories_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, ids);
    // Ones already carrying the link (written after the stream existed) come back unchanged from
    // the engine and are not re-written (skip-if-unchanged).
    const doc_ids = docs.filter((d) => d.isActive !== false).map((d) => d.id);
    if (doc_ids.length === 0)
        return [];
    const collected = [];
    await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
        user_id,
        transaction_ids: doc_ids,
        run_id,
        collect_into: collected,
    });
    return collected;
}
//# sourceMappingURL=sync_item.orchestrator.js.map