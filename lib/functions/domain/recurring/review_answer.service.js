"use strict";
/**
 * Answering a "Bills to review" item (Convert-To-Recurring D9 / D14 / D15 / D24 / X4 / X8) — PURE.
 *
 * Phase 1 answers:
 *   suggested (Plaid)    → `track` (the next sync creates the v2 bill — with the schedule the user
 *                          picked when Plaid said UNKNOWN, D8) | `not_bill` (vendor remembered)
 *   suggested (detector) → `not_bill` only (tracking a detector suggestion is Phase 2: convert)
 *   still_a_bill         → `still_a_bill` (remembered on the record) | `it_ended` (going-forward end)
 *   same_bill            → `keep_separate` (the next sync creates the new stream's own bill);
 *                          `same_bill` (merge) is Phase 2
 *
 * Idempotent (R12): answering an item again with the SAME answer is a no-op; a different answer on
 * an answered item is refused. Answers that must survive the review item's TTL live on the record
 * (end interval / `plaidInactiveAckAt`) or in the review state ("Not a bill" vendors, held-out ids).
 *
 * @module domain/recurring/review_answer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plan_review_answer = plan_review_answer;
const review_item_service_1 = require("./review_item.service");
const FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly", "yearly"]);
const ALLOWED = {
    "suggested:plaid": ["track", "not_bill"],
    "still_a_bill:plaid": ["still_a_bill", "it_ended"],
    "same_bill:plaid": ["keep_separate", "same_bill"],
    "suggested:detector": ["track", "not_bill"],
};
/** Plan an answer. PURE. */
function plan_review_answer(item, answer, now_ms, opts = {}) {
    var _a, _b;
    const allowed = (_a = ALLOWED[`${item.kind}:${item.source}`]) !== null && _a !== void 0 ? _a : [];
    if (!allowed.includes(answer)) {
        const later = (item.kind === "suggested" && item.source === "detector" && answer === "track") ||
            (item.kind === "same_bill" && answer === "same_bill");
        return {
            ok: false,
            error: later
                ? "not available yet — this answer comes with Convert to recurring"
                : `"${answer}" isn't an answer to this question`,
        };
    }
    if (item.status !== "open") {
        if (item.answer === answer || (answer === "track" && item.answer === "converted")) {
            return {
                ok: true,
                plan: { no_op: true, item: null, state_change: {}, record_action: null, resync_item_doc_id: null, merge: null, convert: false },
            };
        }
        return { ok: false, error: "this question was already answered" };
    }
    let user_frequency = null;
    if (answer === "track") {
        const picked = (_b = opts.frequency) !== null && _b !== void 0 ? _b : item.frequency;
        if (!picked || !FREQUENCIES.has(picked)) {
            return { ok: false, error: "pick a schedule for this bill" };
        }
        user_frequency = opts.frequency && FREQUENCIES.has(opts.frequency) ? opts.frequency : null;
    }
    const closed = (0, review_item_service_1.resolve_review_item)(item, answer, now_ms, { user_frequency });
    const plan = {
        no_op: false,
        item: closed,
        state_change: {},
        record_action: null,
        resync_item_doc_id: null,
        merge: null,
        convert: false,
    };
    if (answer === "track" && item.source === "detector") {
        // A detector suggestion has no Plaid stream: tracking it converts its latest payment (the
        // convert orchestrator closes the item `converted`).
        plan.convert = true;
        plan.item = null;
        return { ok: true, plan };
    }
    switch (answer) {
        case "same_bill":
            if (!item.record_id || !item.stream_id)
                return { ok: false, error: "this question has no bill to merge" };
            plan.merge = { old_record_id: item.record_id, into_stream_id: item.stream_id };
        // falls through: the new stream's bill is created now, like "keep separate"
        // eslint-disable-next-line no-fallthrough
        case "track":
        case "keep_separate":
            // The item's payments stay held out of fuzzy matching until the bill actually EXISTS: the
            // capture planner releases them when it creates the v2 record (create_v2), not here — in
            // between, a merchant guess could still link them to an old bill.
            plan.resync_item_doc_id = item.plaid_item_doc_id;
            // Remembered until its bill exists (defect 4): the planner of that Plaid item (or the
            // account's removal) resolves it — never a silently lost track or orphaned held-out ids.
            plan.state_change = {
                add_pending_tracks: [{
                        item_id: item.id,
                        plaid_item_doc_id: item.plaid_item_doc_id,
                        account_id: item.account_id,
                        stream_id: item.stream_id,
                        since_ms: now_ms,
                    }],
            };
            break;
        case "not_bill":
            // Remembered per user + vendor (D11 / D15); its payments stay normal transactions — still
            // held out of fuzzy bill matching.
            plan.state_change = { add_dismissed_vendor_keys: [item.subject_key] };
            break;
        case "still_a_bill":
            plan.record_action = "ack_still_a_bill";
            break;
        case "it_ended":
            plan.record_action = "end";
            break;
        default:
            break;
    }
    return { ok: true, plan };
}
//# sourceMappingURL=review_answer.service.js.map