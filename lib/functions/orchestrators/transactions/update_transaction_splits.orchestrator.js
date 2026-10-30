"use strict";
/**
 * Update Transaction Splits (orchestrator) — a split edit from the app, applied IMMEDIATELY
 * (canon O2, Transaction-Integrity-Review 3g) and read-consciously.
 *
 *   1. build the edit in memory (domain/transactions/split_edit: merge onto the stored splits,
 *      the one category edit rule, totals); re-categorized out of transfers → role "none";
 *   2. if the edit touches anything the engine decides on (split set, category, budget / bill
 *      pins), the engine assigns the transaction IN MEMORY (we hold it — no re-read);
 *      a status / note edit skips that (it only moves spend);
 *   3. write ONCE, stamped (`on_transaction_written` skips it), only if the doc is unchanged since
 *      it was read (else re-read + rebuild the edit on the newer doc — a sync or the re-assign
 *      engine is never overwritten with stale fields); bump the derive version RIGHT AFTER the
 *      write (so a crash later can't leave the period stale);
 *   4. follow-up: an assignment edit runs the one follow-up pass (reconcile, recompute, transfer
 *      re-check only when a category moved); a spend-only edit enqueues the coalesced recompute
 *      (repeated status taps merge into one).
 * If the in-memory assignment fails the edit is still written, unstamped — the trigger assigns it.
 *
 * @module orchestrators/transactions/update_transaction_splits
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleSplitEditError = void 0;
exports.update_transaction_splits_orchestrator = update_transaction_splits_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const split_edit_service_1 = require("../../domain/transactions/split_edit.service");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
const on_read_matching_1 = require("../../resolvers/shared/on_read_matching");
const assign_in_memory_1 = require("./assign_in_memory");
const sync_follow_ups_1 = require("../plaid/sync_follow_ups");
const classify_internal_transfers_orchestrator_1 = require("../plaid/classify_internal_transfers.orchestrator");
const coalesced_jobs_1 = require("../../infrastructure/coalesced_jobs");
/** The app edited an older copy of the transaction: it must re-read and re-apply. */
class StaleSplitEditError extends Error {
    constructor(transaction_id) {
        super(`Transaction ${transaction_id} changed since it was opened`);
        this.name = "StaleSplitEditError";
    }
}
exports.StaleSplitEditError = StaleSplitEditError;
async function update_transaction_splits_orchestrator(ctx, input) {
    const { transaction_id } = input;
    const owner_id = input.txn.userId || input.user_id;
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    for (let attempt = 1;; attempt++) {
        const [fresh] = await transaction_repo_1.transaction_repo.get_raw_by_ids(ctx, [transaction_id]);
        if (!fresh)
            throw new Error(`Transaction ${transaction_id} no longer exists`);
        // The app's splits were built from the copy it read. If the stored transaction changed since,
        // writing them would silently undo that newer write. The conditional write below makes this
        // check atomic with the write (a write landing in between fails it and we re-check).
        if (input.base_updated_at_ms !== undefined) {
            // Not a Timestamp (a legacy string / number): can't compare — skip rather than refuse forever.
            const stored = fresh.data.updatedAt;
            if (typeof (stored === null || stored === void 0 ? void 0 : stored.toMillis) === "function" && stored.toMillis() !== input.base_updated_at_ms) {
                throw new StaleSplitEditError(transaction_id);
            }
        }
        const result = await apply_edit(ctx, input, owner_id, catalog, fresh.data, fresh.update_time);
        if (result)
            return result;
        if (attempt >= MAX_ATTEMPTS) {
            throw new Error(`Transaction ${transaction_id} kept changing; edit not saved — try again`);
        }
    }
}
/** Write attempts when a newer write keeps landing between our read and write. */
const MAX_ATTEMPTS = 3;
/** One attempt: build, assign, conditional write, follow-up. null = lost the race (re-read). */
async function apply_edit(ctx, input, owner_id, catalog, txn, update_time) {
    var _a, _b;
    const { transaction_id } = input;
    const now = firestore_1.Timestamp.now();
    const edit = (0, split_edit_service_1.build_split_edit)(input.splits, txn, catalog, input.user_id, now, (i) => `split_${Date.now()}_${i}`);
    /* eslint-disable @typescript-eslint/naming-convention */
    let update = Object.assign(Object.assign(Object.assign(Object.assign({ splits: edit.splits }, edit.totals), { updatedAt: now, updatedBy: input.user_id }), (input.user_notes !== undefined ? { userNotes: input.user_notes } : {})), (input.is_recurring !== undefined ? { isRecurring: input.is_recurring } : {}));
    // A transaction the user re-categorized OUT of transfers is no longer a transfer: clear its
    // stored role in this same write (the classifier's "none"), so neither the engine nor the app
    // trusts a stale matched-pair role — the classifier's forced pass only revisits recent days.
    // Same effective-category rule as the pairing (first split).
    if (edit.category_changed &&
        typeof txn.transferRole === "string" &&
        txn.transferRole !== "none" &&
        !(0, category_semantics_service_1.is_transfer_category)((0, on_read_matching_1.txn_effective_category)(Object.assign(Object.assign({}, txn), { splits: edit.splits }), catalog))) {
        update.transferRole = "none";
    }
    /* eslint-enable @typescript-eslint/naming-convention */
    const txn_date_ms = (_b = (_a = txn.transactionDate) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a);
    let stamped = false;
    if (edit.assignment_relevant && txn_date_ms !== undefined) {
        try {
            const assign = await (0, assign_in_memory_1.create_in_memory_assigner)(ctx, owner_id, txn_date_ms, txn_date_ms);
            const assigned = await assign(transaction_id, Object.assign(Object.assign({}, txn), update));
            /* eslint-disable @typescript-eslint/naming-convention */
            update = Object.assign(Object.assign({}, update), { splits: assigned.splits, splitBudgetIds: assigned.splitBudgetIds, splitOutflowIds: assigned.splitOutflowIds, splitInflowIds: assigned.splitInflowIds });
            /* eslint-enable @typescript-eslint/naming-convention */
            stamped = true;
        }
        catch (error) {
            // Never lose the user's edit: write it unstamped; the trigger re-assigns it.
            console.error(`[${ctx.trace_id}] in-memory assignment failed; the trigger assigns:`, error);
        }
    }
    else if (!edit.assignment_relevant) {
        stamped = true; // nothing to re-assign; the recompute below covers spend
    }
    if (stamped) {
        update.assignRunId = (0, observability_1.generate_id)();
        update.lastWriteSource = "split_edit";
    }
    if (update_time) {
        const written = await transaction_repo_1.transaction_repo.update_raw_if_unchanged(ctx, transaction_id, update, update_time);
        if (!written)
            return null; // a newer write landed — re-read and rebuild
    }
    else {
        await transaction_repo_1.transaction_repo.update_raw(ctx, transaction_id, update);
    }
    // Right after the write: the period page shows the edit even if anything below fails.
    await (0, derive_version_repo_1.bump_derive_version)(owner_id).catch(() => { });
    const after = Object.assign(Object.assign({}, txn), update);
    if (stamped && edit.assignment_relevant) {
        // Only a category move INTO or OUT OF a transfer category can form / break a matched transfer
        // pair (pairing reads the transaction's transfer meaning — on_read_matching
        // `txn_effective_category`). Groceries → Shopping can't, and the transfer check reads months
        // of transactions, so it runs only when the transfer meaning actually changed.
        const transfer_meaning_changed = edit.category_changed &&
            (0, category_semantics_service_1.is_transfer_category)((0, on_read_matching_1.txn_effective_category)(txn, catalog)) !==
                (0, category_semantics_service_1.is_transfer_category)((0, on_read_matching_1.txn_effective_category)(after, catalog));
        await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, owner_id, Object.assign(Object.assign({}, (0, sync_follow_ups_1.follow_ups_from_written)([{ doc_id: transaction_id, before: txn, after }])), { transfers_changed: false })).catch((error) => console.error(`[${ctx.trace_id}] split-edit follow-up failed:`, error));
        if (transfer_meaning_changed && txn_date_ms !== undefined) {
            // Re-pair only around this transaction (its legs are within the pairing slack).
            await (0, classify_internal_transfers_orchestrator_1.classify_transfers_around)(ctx, owner_id, txn_date_ms).catch((error) => console.error(`[${ctx.trace_id}] split-edit transfer re-check failed:`, error));
        }
    }
    else if (stamped && txn_date_ms !== undefined) {
        // Spend only: coalesced recompute (+ reconcile a bill / income a split pays — its paid
        // amount moved); repeated status taps merge into one run.
        const f = (0, sync_follow_ups_1.follow_ups_from_written)([{ doc_id: transaction_id, before: txn, after }]);
        const budget_ids = Object.keys(f.budget_dates);
        if (budget_ids.length) {
            await (0, coalesced_jobs_1.enqueue_recompute_budget_spent)({
                user_id: owner_id,
                budget_ids,
                transaction_date_ms: txn_date_ms,
                trace_id: ctx.trace_id,
            }).catch(() => { });
        }
        for (const [ids, recurring_type] of [
            [f.outflow_ids, "outflow"],
            [f.inflow_ids, "inflow"],
        ]) {
            for (const recurring_id of ids) {
                await (0, coalesced_jobs_1.enqueue_reconcile_recurring)({
                    user_id: owner_id,
                    recurring_id,
                    recurring_type,
                    trace_id: ctx.trace_id,
                }).catch(() => { });
            }
        }
    }
    return Object.assign({ id: transaction_id }, after);
}
//# sourceMappingURL=update_transaction_splits.orchestrator.js.map