"use strict";
/**
 * Convert Transaction To Recurring Orchestrator (Convert-To-Recurring Phase 2, D1–D4, D40–D46).
 *
 * "Make this a bill / income": one tap on a transaction (or one split).
 *
 *   flag + purge → resolve (owner first, then facts) → plan (pure: refusals, record, which past
 *   payments link) → ONE Firestore transaction creates the record and pins the source split →
 *   periods generated inline → the chosen past payments assigned in memory by the engine (D1) →
 *   ONE follow-up pass (reconcile the record, recompute only the touched budget periods, one derive
 *   bump) → the vendor's review question closed `converted` → a `retroLinkedAt` marker.
 *
 * Cost shape: one convert is a bounded one-time cost and writes NOTHING per document through
 * triggers — every write is stamped (`syncRunId` on the record, `assignRunId` on transactions), 0
 * jobs, 1 derive bump, no transfer re-check, no classifier run. A timeout leaves a record without
 * `retroLinkedAt`; the next tap RESUMES it (never a second bill) — and never reopens a bill the
 * user removed meanwhile.
 *
 * @module orchestrators/recurring/convert_transaction_to_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.convert_transaction_to_recurring_orchestrator = convert_transaction_to_recurring_orchestrator;
const crypto_1 = require("crypto");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const purge_guard_1 = require("../../infrastructure/purge_guard");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const convert_recurring_repo_1 = require("../../repositories/convert_recurring.repo");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const convert_resolver_1 = require("../../resolvers/recurring/convert.resolver");
const convert_plan_service_1 = require("../../domain/recurring/convert_plan.service");
const convert_review_service_1 = require("../../domain/recurring/convert_review.service");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
const generate_periods_inline_1 = require("./generate_periods_inline");
const assign_transactions_batch_orchestrator_1 = require("../transactions/assign_transactions_batch.orchestrator");
const sync_follow_ups_1 = require("../plaid/sync_follow_ups");
const merge_service_1 = require("../../domain/recurring/merge.service");
const last_payment_resolver_1 = require("../../resolvers/recurring/last_payment.resolver");
const reassign_user_orchestrator_1 = require("../transactions/reassign_user.orchestrator");
async function convert_transaction_to_recurring_orchestrator(ctx, user_id, input, now_ms) {
    var _a, _b, _c, _d, _e, _f;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "convert_transaction_to_recurring");
    (0, observability_1.log_operation_start)(span, user_id);
    let created = null;
    let follow_up_done = false;
    try {
        if (!(await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id))) {
            throw new types_1.ConvertRefusedError("FEATURE_OFF", "Making a transaction a bill isn't available on this account yet");
        }
        if (await (0, purge_guard_1.is_user_purging)(user_id))
            throw new types_1.ConvertRefusedError("PURGING", "This account is being erased");
        // The client's review item must be this user's own, before anything is read for it.
        if (input.review_item_id !== undefined && !(0, convert_review_service_1.is_own_review_item_id)(user_id, input.review_item_id)) {
            throw new types_1.ValidationError(["That suggestion doesn't belong to you"]);
        }
        // 1. Resolve — owner first; nothing else is read for someone else's transaction.
        const r = await (0, convert_resolver_1.resolve_convert_facts)(ctx, user_id, input.transaction_id, now_ms, input.split_id);
        if (!r.ok) {
            if (r.reason === "not_found")
                throw new types_1.NotFoundError("transaction", input.transaction_id);
            throw new types_1.PermissionDeniedError("convert_transaction_to_recurring", input.transaction_id);
        }
        // A record already made from this transaction: resume it (never a second bill). A removed one
        // (even unfinished) is like any other existing conversion: refused below; the way out of
        // CONVERT_FAILED is to delete it (D47), after which the next convert starts fresh.
        const existing = r.existing_conversion;
        if (existing) {
            if (!existing.live) {
                const income = (0, convert_plan_service_1.direction_of)(r.facts.txn.type) === "inflow";
                throw new types_1.ConvertRefusedError("ALREADY_TRACKED", income ? "This was already made into income" : "This was already made into a bill", {
                    id: existing.id, name: existing.name,
                });
            }
            const direction = (0, convert_plan_service_1.direction_of)(r.facts.txn.type);
            created = { id: existing.id, direction };
            if (!existing.retro_done) {
                // Only one resume at a time: a concurrent double tap returns the existing bill.
                const repo = direction === "outflow" ? outflow_repo_1.outflow_repo : inflow_repo_1.inflow_repo;
                const claimed = await repo.claim_resume(ctx, existing.id, now_ms).catch((e) => {
                    follow_up_done = true; // a convert that gave up: nothing more runs, no bump
                    throw e;
                });
                if (!claimed) {
                    follow_up_done = true;
                    return { id: existing.id, direction, already: true, in_progress: true, linked_past_count: 0, first_date_ms: null, next_due_ms: null, next_due_clamped: false };
                }
                const resumed = await complete_convert(ctx, user_id, direction, existing.id, now_ms, null);
                follow_up_done = true;
                if (resumed.in_progress) {
                    // Periods could not all be generated: no marker, the lease goes back for an immediate retry.
                    await repo.release_resume_lease(ctx, existing.id, `convert_release_${(0, crypto_1.randomUUID)()}`).catch(() => { });
                    return Object.assign(Object.assign({}, resumed), { already: true });
                }
                const rec = (await repo.get_raw_by_ids(ctx, [existing.id])).get(existing.id);
                await finish_convert(ctx, user_id, direction, existing.id, (_b = (_a = rec === null || rec === void 0 ? void 0 : rec.vendorKey) !== null && _a !== void 0 ? _a : r.facts.txn.vendor_key) !== null && _b !== void 0 ? _b : "", (_c = rec === null || rec === void 0 ? void 0 : rec.accountId) !== null && _c !== void 0 ? _c : r.facts.txn.account_id, r.old_bills, input.review_item_id, now_ms, `convert_resume_${(0, crypto_1.randomUUID)()}`);
                return Object.assign(Object.assign({}, resumed), { already: true });
            }
            return { id: existing.id, direction, already: true, linked_past_count: 0, first_date_ms: null, next_due_ms: null, next_due_clamped: false };
        }
        // 2. Plan (pure).
        const id = `conv_${(0, crypto_1.randomUUID)()}`;
        const req = {
            split_id: input.split_id, name: input.name, amount: input.amount, frequency: input.frequency,
            next_due_date: input.next_due_date, link_past: input.link_past,
        };
        const plan = (0, convert_plan_service_1.plan_convert)(r.facts, req, id);
        if (!plan.ok) {
            if (plan.code === "VALIDATION_ERROR")
                throw new types_1.ValidationError([plan.message]);
            if (plan.code === "NOT_FOUND")
                throw new types_1.NotFoundError("transaction_split", (_d = input.split_id) !== null && _d !== void 0 ? _d : "");
            throw new types_1.ConvertRefusedError(plan.code, plan.message, plan.details);
        }
        // The vendor's open question (looked up by its deterministic id, plus the one the app named).
        // The named item must match this transaction BEFORE anything is written (finish_convert re-plans).
        {
            const by_vendor_id = (0, convert_review_service_1.suggested_item_id)(user_id, plan.direction, plan.vendor_key);
            const items = await recurring_review_repo_1.recurring_review_repo.get_items_by_ids(ctx, [by_vendor_id, ...(input.review_item_id ? [input.review_item_id] : [])]);
            const check = (0, convert_review_service_1.plan_convert_review)(user_id, plan.direction, plan.vendor_key, input.review_item_id ? (_e = items.get(input.review_item_id)) !== null && _e !== void 0 ? _e : null : null, (_f = items.get(by_vendor_id)) !== null && _f !== void 0 ? _f : null, input.review_item_id !== undefined, now_ms);
            if (!check.ok)
                throw new types_1.ValidationError([check.error]);
        }
        // 3. Write: the record + the source pin, atomically. The retro-linked Plaid ids ride on the
        //    record from the start, so D1 keeps those past payments linked on every later pass.
        const run_id = `convert_${(0, crypto_1.randomUUID)()}`;
        const entity = Object.assign(Object.assign({}, plan.entity), (plan.retro_plaid_ids.length ? { retro_txn_ids: plan.retro_plaid_ids } : {}));
        const result = await convert_recurring_repo_1.convert_recurring_repo.create_with_source_pin(ctx, {
            direction: plan.direction, entity, user_id, run_id,
            source_txn_doc_id: input.transaction_id, source_split_ids: plan.source_split_ids,
        });
        if (result.status === "already_converted") {
            // A simultaneous tap of the same transaction made the record: this tap does nothing.
            follow_up_done = true;
            return Object.assign(Object.assign({ id: result.existing_id, direction: plan.direction, already: true }, (result.in_progress ? { in_progress: true } : {})), { linked_past_count: 0, first_date_ms: null, next_due_ms: null, next_due_clamped: false });
        }
        if (result.status === "already_tracked") {
            throw new types_1.ConvertRefusedError("ALREADY_TRACKED", `This is already part of ${result.existing_name || "a bill"}`, {
                id: result.existing_id, name: result.existing_name,
            });
        }
        created = { id, direction: plan.direction };
        // 4–6. Periods, the chosen past payments, the single follow-up pass, the marker.
        const completed = await complete_convert(ctx, user_id, plan.direction, id, now_ms, {
            run_id, record: result.record, source: { doc_id: input.transaction_id, before: result.source_before, after: result.source_after },
            retro_doc_ids: plan.retro_doc_ids,
        });
        follow_up_done = true;
        if (completed.in_progress) {
            const repo = plan.direction === "outflow" ? outflow_repo_1.outflow_repo : inflow_repo_1.inflow_repo;
            await repo.release_resume_lease(ctx, id, `convert_release_${(0, crypto_1.randomUUID)()}`).catch(() => { });
            return completed;
        }
        await finish_convert(ctx, user_id, plan.direction, id, plan.vendor_key, plan.entity.account_id, r.old_bills, input.review_item_id, now_ms, run_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return {
            id, direction: plan.direction, already: false, linked_past_count: plan.retro_doc_ids.length,
            first_date_ms: plan.first_date_ms, next_due_ms: plan.next_due_ms, next_due_clamped: plan.next_due_clamped,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
    finally {
        // The bill (and its pin) exist but the follow-up never ran: the one bump still lands.
        if (created && !follow_up_done)
            await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
    }
}
/**
 * The steps after the record exists — shared by a fresh convert and a resume: stored periods, the
 * past payments the record lists (`retroTxnIds`) assigned in memory, ONE follow-up pass, then the
 * `retroLinkedAt` marker. Idempotent: periods are generated only when none exist; the engine
 * writes only what changes; the marker is stamped so no trigger fans out.
 */
async function complete_convert(ctx, user_id, direction, id, now_ms, fresh) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const repo = direction === "outflow" ? outflow_repo_1.outflow_repo : inflow_repo_1.inflow_repo;
    const run_id = (_a = fresh === null || fresh === void 0 ? void 0 : fresh.run_id) !== null && _a !== void 0 ? _a : `convert_resume_${(0, crypto_1.randomUUID)()}`;
    // A resume reads the stored record (and its listed past payments); a fresh convert already has them.
    const stored = fresh ? null : await repo.get_raw_by_ids(ctx, [id]).then((m) => { var _a; return (_a = m.get(id)) !== null && _a !== void 0 ? _a : null; });
    const record = (_b = fresh === null || fresh === void 0 ? void 0 : fresh.record) !== null && _b !== void 0 ? _b : stored;
    if (!record)
        throw new types_1.NotFoundError(direction, id);
    const retro_docs = fresh
        ? []
        : (await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, (_c = record.retroTxnIds) !== null && _c !== void 0 ? _c : []))
            .filter((t) => t.isActive !== false);
    const retro_doc_ids = fresh ? fresh.retro_doc_ids : retro_docs.map((t) => t.id);
    // A resume of a convert whose periods + follow-ups already finished has nothing to redo there.
    const done_before = !fresh && typeof record.followUpsDoneAtMs === "number";
    // 4. Stored periods (the create trigger skips a stamped record). Generation is idempotent
    //    (deterministic ids), so a resume regenerates ALL of them: a partial set is filled in.
    let periods_ok = true;
    if (!done_before) {
        const failed = await (0, generate_periods_inline_1.generate_periods_inline)(ctx, user_id, [{ id, kind: direction, created: true, before: null, after: record }], true);
        periods_ok = failed.length === 0;
        // Periods a resume just created are not yet suppressed: re-apply the record's removal / pause
        // intervals (only periods whose flag changes are written).
        const intervals = (_d = record.removalIntervals) !== null && _d !== void 0 ? _d : [];
        if (!fresh && intervals.length > 0) {
            await repo.apply_period_suppression(ctx, id, intervals.map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })), user_id);
        }
    }
    // 5. The chosen past payments: assigned IN MEMORY by the engine (D1 links them), written once,
    //    stamped; candidates scoped to this record only.
    const written = fresh
        ? [{ doc_id: fresh.source.doc_id, before: fresh.source.before, after: fresh.source.after }]
        : [];
    if (retro_doc_ids.length > 0) {
        await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
            user_id, transaction_ids: retro_doc_ids, run_id, collect_into: written,
            candidate_outflow_ids: direction === "outflow" ? [id] : [],
            candidate_inflow_ids: direction === "inflow" ? [id] : [],
        });
    }
    // 6. ONE follow-up pass: reconcile the record, recompute only the touched budget periods, one
    //    derive bump. No transfer re-check (a loan vendor must not force a 180-day classifier scan).
    //    A resume that finds everything finished and the engine writing nothing skips it.
    if (!(done_before && written.length === 0)) {
        let f = (0, sync_follow_ups_1.follow_ups_from_written)(written);
        if (!fresh)
            f = (0, sync_follow_ups_1.merge_follow_ups)(f, await resume_budget_seed(ctx, record, retro_docs));
        await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, user_id, Object.assign(Object.assign({}, f), { outflow_ids: direction === "outflow" ? [...new Set([...f.outflow_ids, id])] : f.outflow_ids, inflow_ids: direction === "inflow" ? [...new Set([...f.inflow_ids, id])] : f.inflow_ids, transactions_changed: true, recurring_changed: false, transfers_changed: false }), { preload_budget_window: true });
        // Stamped only once the pass succeeded AND every period was generated.
        if (periods_ok)
            await repo.mark_follow_ups_done(ctx, id, now_ms, `convert_fu_${(0, crypto_1.randomUUID)()}`);
    }
    return Object.assign(Object.assign({ id, direction, already: false, linked_past_count: retro_doc_ids.length }, (periods_ok ? {} : { in_progress: true })), { first_date_ms: (_g = (_f = (_e = record.firstDate) === null || _e === void 0 ? void 0 : _e.toMillis) === null || _f === void 0 ? void 0 : _f.call(_e)) !== null && _g !== void 0 ? _g : null, next_due_ms: (_k = (_j = (_h = record.predictedNextDate) === null || _h === void 0 ? void 0 : _h.toMillis) === null || _j === void 0 ? void 0 : _j.call(_h)) !== null && _k !== void 0 ? _k : null, next_due_clamped: false });
}
/**
 * What a RESUMED convert must recompute, from the stored record: the source split's budget(s) — it
 * left them when it was linked — and the budgets the listed past payments sit in, on the dates of
 * the source and those payments. (The first run's before/after is gone; the budgets the split was
 * in were stored with the record.)
 */
async function resume_budget_seed(ctx, record, retro_docs) {
    var _a;
    const date_of = (d) => {
        var _a, _b;
        const t = d.transactionDate;
        return (_b = (_a = t === null || t === void 0 ? void 0 : t.toMillis) === null || _a === void 0 ? void 0 : _a.call(t)) !== null && _b !== void 0 ? _b : null;
    };
    const budgets_of = (d) => {
        var _a;
        const denorm = d.splitBudgetIds;
        const from_splits = ((_a = d.splits) !== null && _a !== void 0 ? _a : []).map((x) => x.budgetId);
        return [...(denorm !== null && denorm !== void 0 ? denorm : []), ...from_splits].filter((b) => !!b && b !== "unassigned");
    };
    const docs = [...retro_docs];
    const source_id = record.convertedFromTxnId;
    if (source_id)
        docs.push(...(await transaction_repo_1.transaction_repo.get_raw_by_ids(ctx, [source_id])).map((x) => x.data));
    const dates = [...new Set(docs.map(date_of).filter((x) => x !== null))];
    const budgets = new Set([
        ...((_a = record.convertedSourceBudgetIds) !== null && _a !== void 0 ? _a : []),
        ...docs.flatMap(budgets_of),
    ]);
    const out = (0, sync_follow_ups_1.empty_follow_ups)();
    for (const b of budgets)
        out.budget_dates[b] = dates;
    return out;
}
/**
 * The last steps — IDEMPOTENT, shared by a fresh convert and a resume: the D41 merge of old stopped
 * bills, the vendor's review question, and (last, so a death before it makes the next tap resume
 * everything) the `retroLinkedAt` marker.
 */
async function finish_convert(ctx, user_id, direction, id, vendor_key, account_id, old_bills, review_item_id, now_ms, run_id) {
    var _a, _b;
    const repo = direction === "outflow" ? outflow_repo_1.outflow_repo : inflow_repo_1.inflow_repo;
    // 6b. D41 — an old, turned-off / stale record of the same vendor on this account is the same
    //     bill: the user tapped Convert, so it ends at its last payment and merges into the new one
    //     (kept active, out of the Removed list, undoable). History moves nowhere: the retro-link
    //     skipped its payments.
    if (old_bills.length > 0) {
        const repo = direction === "outflow" ? outflow_repo_1.outflow_repo : inflow_repo_1.inflow_repo;
        const month_start = Date.UTC(new Date(now_ms).getUTCFullYear(), new Date(now_ms).getUTCMonth(), 1);
        let from_ms = month_start;
        let merged_any = false;
        for (const old of old_bills) {
            const mp = (0, merge_service_1.plan_merge_old_into_new)(Object.assign(Object.assign({}, old), { last_payment_ms: await (0, last_payment_resolver_1.resolve_last_payment_ms)(ctx, user_id, direction, old.id, old.last_payment_ms) }), id, now_ms, month_start);
            if (!mp)
                continue;
            merged_any = true;
            await repo.apply_merge(ctx, old.id, { intervals: mp.intervals, merged_into_id: id, merge_log: mp.merge_log }, run_id);
            await repo.apply_period_suppression(ctx, old.id, mp.intervals, user_id);
            from_ms = Math.min(from_ms, mp.intervals[mp.intervals.length - 1].from_ms);
        }
        if (merged_any) {
            await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({
                user_id, reason: "recurring_removal", scope: { account_ids: [account_id], from_ms },
            }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] convert merge re-assign enqueue failed:`, e));
            await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
        }
    }
    // 7. The vendor's question: closed `converted`; its held-out payments released; a "Not a bill"
    //    memory forgotten. Guarded state write (a racing sync's change is never lost).
    const by_vendor_id = (0, convert_review_service_1.suggested_item_id)(user_id, direction, vendor_key);
    const items = await recurring_review_repo_1.recurring_review_repo.get_items_by_ids(ctx, [by_vendor_id, ...(review_item_id ? [review_item_id] : [])]);
    const review = (0, convert_review_service_1.plan_convert_review)(user_id, direction, vendor_key, review_item_id ? (_a = items.get(review_item_id)) !== null && _a !== void 0 ? _a : null : null, (_b = items.get(by_vendor_id)) !== null && _b !== void 0 ? _b : null, review_item_id !== undefined, now_ms);
    if (review.ok) {
        if (review.items.length > 0)
            await recurring_review_repo_1.recurring_review_repo.upsert_items(ctx, review.items);
        const current = await recurring_review_repo_1.recurring_review_repo.get_state(ctx, user_id);
        if ((0, review_item_service_1.apply_review_state_change)(current, user_id, review.state_change).changed) {
            const next = await recurring_review_repo_1.recurring_review_repo.apply_state_change(ctx, user_id, review.state_change);
            if (next.suppressed_changed)
                await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
        }
    }
    await repo.mark_retro_linked(ctx, id, now_ms, `convert_done_${(0, crypto_1.randomUUID)()}`);
}
//# sourceMappingURL=convert_transaction_to_recurring.orchestrator.js.map