"use strict";
/**
 * Detect Possible Recurring Orchestrator (Convert-To-Recurring D11 / X12 / X14 / X17 / X19).
 *
 * The "possible bill" detector runs at most once per user per UTC day, flag-on users only, on the
 * transactions the transfer classifier ALREADY loaded for its full scan (X12: no extra transaction
 * read). ONE way in: `run_detector_on_scan` is called by `classify_internal_transfers_orchestrator`
 * after any full scan it was going to do anyway. There is deliberately NO fallback job: a job
 * that forces a classifier scan would cost a full transaction read (X12 says zero extra reads).
 * A day without a full scan simply has no detector run; the throttle (detector day in the review
 * state doc) keeps it to at most once per UTC day.
 *
 * Writes: suggested review items (only new / changed ones) + the state's detector day. Never a
 * dismissed vendor (R11), never a bill record, never a derive bump (detector items don't feed the
 * derive). Checks `is_user_purging` before writing (X19).
 *
 * @module orchestrators/recurring/detect_possible_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.run_detector_on_scan = run_detector_on_scan;
const purge_guard_1 = require("../../infrastructure/purge_guard");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const recurring_detector_resolver_1 = require("../../resolvers/recurring/recurring_detector.resolver");
const recurring_detector_service_1 = require("../../domain/recurring/recurring_detector.service");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
/** Run the detector on a classifier scan (inline path). Non-throwing callers wrap it. */
async function run_detector_on_scan(ctx, user_id, now_ms, scan) {
    const none = (reason) => ({ ran: false, reason, candidates: 0, items_written: 0, capped: false });
    if (!(await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id)))
        return none("flag_off");
    // 1. State (1 read) — the daily throttle + held-out ids + "Not a bill" vendors.
    const state = await recurring_review_repo_1.recurring_review_repo.get_state(ctx, user_id);
    const today = (0, review_item_service_1.utc_day)(now_ms);
    if ((state === null || state === void 0 ? void 0 : state.detector_last_run_day) === today)
        return none("already_today");
    // 2. Everything else it needs, read-only (inactive records' stream ids; item lookups by id).
    const base = await (0, recurring_detector_resolver_1.resolve_detector_context)(ctx, user_id, scan);
    let found = (0, recurring_detector_service_1.detect_candidates)({
        user_id, now_ms, txns: scan.txns, internal_txn_ids: scan.internal_txn_ids,
        record_txn_ids: base.record_txn_ids, record_vendor_subjects: base.record_vendor_subjects,
        state, account_types: null,
    });
    if (found.needs_account_types) {
        found = (0, recurring_detector_service_1.detect_candidates)({
            user_id, now_ms, txns: scan.txns, internal_txn_ids: scan.internal_txn_ids,
            record_txn_ids: base.record_txn_ids, record_vendor_subjects: base.record_vendor_subjects,
            state, account_types: await base.load_account_types(),
        });
    }
    if (found.capped) {
        console.warn(`[${ctx.trace_id}] detector: ${scan.txns.length} txns > cap — the most recent were used (user ${user_id})`);
    }
    const existing = await base.load_items(found.candidates.map((c) => c.item_id));
    const items = (0, recurring_detector_service_1.detector_items)(user_id, now_ms, found.candidates, existing);
    // 3. Persist (never into a user being erased).
    if (await (0, purge_guard_1.is_user_purging)(user_id))
        return none("purging");
    // Guarded (defect 1): never reverts an item the user answered while the detector ran.
    const written = (await recurring_review_repo_1.recurring_review_repo.write_items_guarded(ctx, user_id, items, existing)).written;
    if ((0, review_item_service_1.apply_review_state_change)(state, user_id, { detector_last_run_day: today }).changed) {
        // Atomic against the fresh doc (a concurrent "Not a bill" / sync write is never lost).
        await recurring_review_repo_1.recurring_review_repo.apply_state_change(ctx, user_id, { detector_last_run_day: today });
    }
    console.log(`[${ctx.trace_id}] detector ${user_id}: candidates=${found.candidates.length} written=${written}`);
    return { ran: true, candidates: found.candidates.length, items_written: written, capped: found.capped };
}
//# sourceMappingURL=detect_possible_recurring.orchestrator.js.map