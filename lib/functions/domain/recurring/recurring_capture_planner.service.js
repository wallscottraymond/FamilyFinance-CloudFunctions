"use strict";
/**
 * Recurring Capture Planner (Convert-To-Recurring Phase 1) — what a recurring sync does with each
 * Plaid stream under the new capture rules. PURE: the orchestrator loads, this decides, repos write.
 *
 * It only ever changes behavior for (a) records stamped v2 and (b) NEW streams while the user's
 * flag is on. A record that existed without the stamp is passed through exactly as today (D13).
 *
 * Per stream:
 *   - OLD record (no stamp)   → saved as today; stale-marked as today.
 *   - v2 record               → ALWAYS saved (X10, whatever Plaid's status / frequency says);
 *                               `is_active` stays OURS, Plaid's flag goes to `plaid_is_active`;
 *                               a shown bill that CHANGES to Plaid-inactive opens "Still a bill?"
 *                               (X2, D5); back to active closes it. Never stale-marked: a v2 bill
 *                               Plaid stops returning is asked about instead (D19), a rejected one
 *                               is left alone (gap 8).
 *   - NEW stream, flag off    → today's handling (saved, unstamped).
 *   - NEW stream, flag on:
 *       first seen inactive   → today's handling (X2: no active bill, no question);
 *       tombstoned            → skipped (D17);
 *       answered "track" / "keep separate" → created v2 (with the picked schedule, D8);
 *       vendor "Not a bill"   → skipped (X14: a maturing stream checks dismissals);
 *       low confidence        → no record; one `suggested` item per vendor (D6/D8, X14) when the
 *                               stream may be suggested at all (no transfers; income gates, X17);
 *       mature                → created v2 (stamped at creation, X1).
 * Every NEW stream not saved has its Plaid transaction ids held out of fuzzy bill matching (X3)
 * — they're normal transactions, never linked to an old bill by a merchant guess.
 *
 * @module domain/recurring/recurring_capture_planner
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STREAM_VENDOR_PREFIX = void 0;
exports.compose_state_change = compose_state_change;
exports.drop_failed_saves = drop_failed_saves;
exports.review_ids_for_sync = review_ids_for_sync;
exports.stream_vendor = stream_vendor;
exports.plan_recurring_capture = plan_recurring_capture;
const vendor_key_service_1 = require("../transactions/vendor_key.service");
const capture_rules_1 = require("./capture_rules");
const review_item_service_1 = require("./review_item.service");
const recurring_suppression_service_1 = require("./recurring_suppression.service");
const same_bill_service_1 = require("./same_bill.service");
const absorb_service_1 = require("./absorb.service");
/** base + effects → the state change; ids both held out and released end released (stream
 *  membership wins). PURE. */
function compose_state_change(base, effects) {
    var _a;
    const remove = new Set([...base.remove_suppressed, ...effects.flatMap((e) => e.release)]);
    const pending = [...new Set([...base.remove_pending_track_ids, ...effects.flatMap((e) => e.remove_pending)])];
    const removed_pending = new Set(pending);
    const add_pending = ((_a = base.add_pending_tracks) !== null && _a !== void 0 ? _a : []).filter((p) => !removed_pending.has(p.item_id));
    return Object.assign(Object.assign(Object.assign(Object.assign({ add_suppressed: [...new Set(base.add_suppressed)].filter((id) => !remove.has(id)), remove_suppressed: [...remove] }, (pending.length > 0 ? { remove_pending_track_ids: pending } : {})), (add_pending.length > 0 ? { add_pending_tracks: add_pending } : {})), (base.set_suggested_owners ? { set_suggested_owners: base.set_suggested_owners } : {})), (base.keep_owner_item_doc_ids ? { keep_owner_item_doc_ids: base.keep_owner_item_doc_ids } : {}));
}
/**
 * A save batch failed for these directions: nothing that depended on those saves may land — the
 * held-out ids stay held, the items they would have closed stay as they are, so the next sync
 * (which sees no record yet) does it all again (review round 3 defect 3). PURE.
 */
function drop_failed_saves(plan, failed) {
    if (failed.size === 0 || !plan.save_effects || !plan.base_change)
        return plan;
    const ok = plan.save_effects.filter((e) => !failed.has(e.direction));
    const dropped_items = new Set(plan.save_effects.filter((e) => failed.has(e.direction)).flatMap((e) => e.item_ids));
    return Object.assign(Object.assign({}, plan), { save_effects: ok, state_change: compose_state_change(plan.base_change, ok), review_items: plan.review_items.filter((i) => !dropped_items.has(i.id)) });
}
/** The review-item ids a sync must look up for this response (X8: getAll, no query). */
function review_ids_for_sync(user_id, streams, records, 
/** Streams a converted record already absorbed: they never get a tile or a question, so their
 *  two item ids are not looked up on every sync (a missing doc is still billed). */
absorbed_stream_ids = new Set()) {
    const ids = new Set();
    const has_record = new Set(records.map((r) => r.id));
    for (const s of streams) {
        if (has_record.has(s.stream_id))
            continue; // suggested / same-bill only apply to NEW streams
        if (absorbed_stream_ids.has(s.stream_id))
            continue;
        ids.add((0, review_item_service_1.build_review_item_id)(user_id, "suggested", (0, review_item_service_1.suggested_subject)(s.direction, stream_vendor(s))));
        ids.add((0, review_item_service_1.build_review_item_id)(user_id, "same_bill", s.stream_id));
    }
    // A "Still a bill?" item can exist only for a v2 record Plaid has (or now reports) off, or that
    // Plaid stopped returning — every other v2 record needs no lookup.
    const raw_active = new Map(streams.map((s) => [s.stream_id, s.raw_is_active]));
    for (const r of records) {
        if (!r.v2)
            continue;
        const in_response = raw_active.has(r.id);
        if (r.plaid_is_active === false || !in_response || raw_active.get(r.id) === false) {
            ids.add((0, review_item_service_1.build_review_item_id)(user_id, "still_a_bill", r.id));
        }
    }
    return [...ids];
}
/**
 * The vendor key a stream is suggested under; a stream with no merchant / description falls back
 * to its stream id under an UPPER-CASE prefix. Real vendor keys are always lower-cased
 * (`vendor_key_from_name`), so the fallback can never collide with a vendor — not even one named
 * "stream:<id>" (it used `stream:<id>`, which such a merchant would produce; extra test).
 */
exports.STREAM_VENDOR_PREFIX = "STREAM:";
function stream_vendor(s) {
    var _a;
    return (_a = (0, vendor_key_service_1.vendor_key)({ merchant_name: s.merchant_name, name: s.description })) !== null && _a !== void 0 ? _a : `${exports.STREAM_VENDOR_PREFIX}${s.stream_id}`;
}
const app_frequency = (raw) => {
    switch (String(raw).toUpperCase()) {
        case "WEEKLY": return "weekly";
        case "BIWEEKLY": return "biweekly";
        case "SEMI_MONTHLY": return "semimonthly";
        case "MONTHLY": return "monthly";
        case "ANNUALLY": return "yearly";
        default: return null;
    }
};
/**
 * The record as it will be AFTER this sync saves the stream's entity: a question built from the
 * pre-save record changed again on the next identical sync (one extra item write each time Plaid
 * changed a field — found by the planner property test, Top-25 #23).
 */
function as_saved(ex, s, saved) {
    var _a, _b, _c;
    const merchant = s.direction === "outflow"
        ? (_a = saved.merchant_name) !== null && _a !== void 0 ? _a : null
        : (_b = saved.payer_name) !== null && _b !== void 0 ? _b : null;
    return Object.assign(Object.assign({}, ex), { merchant_name: merchant, description: (_c = saved.description) !== null && _c !== void 0 ? _c : null, name: ex.custom_name || merchant || saved.description || (s.direction === "outflow" ? "Bill" : "Income"), average_amount: saved.average_amount, frequency: saved.frequency, plaid_status: saved.plaid_status, plaid_detailed_category: saved.plaid_detailed_category, account_id: saved.account_id });
}
/**
 * A "Still a bill?" the system closed only because the bill went out of sight (its account was
 * removed, or the user removed / paused it) is asked again once the bill is back in sight and
 * Plaid still has it off — otherwise restoring the account (or the bill) silently drops the
 * question (Top-25 #16). Never one the user answered (that is `is_user_answered`).
 */
const reopens = (item) => !!item && item.status !== "open" && (item.answer === "account_removed" || item.answer === "not_shown");
/** Is the record a bill the user currently sees (active, not hidden, not removed, not merged)? */
function is_shown(r, now_ms) {
    return (r.is_active &&
        !r.is_hidden &&
        !r.merged_into_id &&
        !(0, recurring_suppression_service_1.is_currently_suppressed)(r.removal_intervals, now_ms));
}
function still_a_bill_item(input, r, existing) {
    return (0, review_item_service_1.make_review_item)({
        user_id: input.user_id,
        kind: "still_a_bill",
        direction: r.direction,
        source: "plaid",
        status: "open",
        answer: null,
        subject_key: r.id,
        vendor_key: (0, vendor_key_service_1.vendor_key)({ merchant_name: r.merchant_name, name: r.description }),
        account_id: r.account_id,
        plaid_item_doc_id: input.plaid_item_doc_id,
        stream_id: r.id,
        record_id: r.id,
        name: r.name,
        amount: r.average_amount,
        frequency: r.frequency,
        plaid_status: r.plaid_status,
        category: r.plaid_detailed_category,
        transaction_ids: [],
        next_due_ms: null,
        user_frequency: null,
        resolved_at_ms: null,
    }, input.now_ms, existing);
}
function suggested_item(input, s, existing) {
    var _a;
    const vk = stream_vendor(s);
    return (0, review_item_service_1.make_review_item)({
        user_id: input.user_id,
        kind: "suggested",
        direction: s.direction,
        source: "plaid",
        status: "open",
        answer: null,
        subject_key: (0, review_item_service_1.suggested_subject)(s.direction, vk),
        vendor_key: vk,
        account_id: s.account_id,
        plaid_item_doc_id: input.plaid_item_doc_id,
        stream_id: s.stream_id,
        record_id: null,
        name: s.merchant_name || s.description || (s.direction === "outflow" ? "Bill" : "Income"),
        amount: Math.abs(s.average_amount),
        frequency: app_frequency(s.raw_frequency),
        plaid_status: String((_a = s.raw_status) !== null && _a !== void 0 ? _a : "UNKNOWN").toUpperCase(),
        category: s.detailed_category,
        transaction_ids: s.transaction_ids,
        next_due_ms: s.predicted_next_ms,
        user_frequency: null,
        resolved_at_ms: null,
    }, input.now_ms, existing);
}
function same_bill_item(input, s, old, existing) {
    var _a;
    return (0, review_item_service_1.make_review_item)({
        user_id: input.user_id,
        kind: "same_bill",
        direction: s.direction,
        source: "plaid",
        status: "open",
        answer: null,
        subject_key: s.stream_id,
        vendor_key: stream_vendor(s),
        account_id: s.account_id,
        plaid_item_doc_id: input.plaid_item_doc_id,
        stream_id: s.stream_id,
        record_id: old.id,
        // "Looks like <the bill you know> changed. Same bill?"
        name: old.name,
        amount: Math.abs(s.average_amount),
        frequency: app_frequency(s.raw_frequency),
        plaid_status: String((_a = s.raw_status) !== null && _a !== void 0 ? _a : "UNKNOWN").toUpperCase(),
        category: s.detailed_category,
        transaction_ids: s.transaction_ids,
        next_due_ms: s.predicted_next_ms,
        user_frequency: null,
        resolved_at_ms: null,
    }, input.now_ms, existing);
}
/** Plan one recurring sync under the capture rules. PURE. */
function plan_recurring_capture(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    const plan = {
        save_outflows: [],
        save_inflows: [],
        stale_outflow_ids: [],
        stale_inflow_ids: [],
        plaid_inactive_outflow_ids: [],
        plaid_inactive_inflow_ids: [],
        review_items: [],
        state_change: { add_suppressed: [], remove_suppressed: [] },
    };
    // Every saved stream releases its own ids: a saved stream's payments are never held out
    // (stream membership wins — this is also what frees a track saved UNSTAMPED, defect 4).
    const save = (s, e, v2 = false) => {
        if (s.direction === "outflow")
            plan.save_outflows.push(e);
        else
            plan.save_inflows.push(e);
        saved_ids.add(s.stream_id);
        const subject = (0, review_item_service_1.suggested_subject)(s.direction, stream_vendor(s));
        if (v2 && !saved_by_subject.has(subject))
            saved_by_subject.set(subject, s);
        effect(s).release.push(...s.transaction_ids);
    };
    const saved_ids = new Set();
    /** The first stream of each (direction, vendor) saved as a v2 bill this round — fulfils that
     *  vendor's tracks whose own stream is gone (defect 2). An OLD bill of the vendor never does. */
    const saved_by_subject = new Map();
    const item_at = (kind, subject) => input.review_items.get((0, review_item_service_1.build_review_item_id)(input.user_id, kind, subject));
    const suggest_candidates = [];
    const in_response_stream_ids = new Set(input.streams.map((x) => x.stream_id));
    const absorb_writes = new Map();
    const matured = new Map();
    const base_change = { add_suppressed: [], remove_suppressed: [], remove_pending_track_ids: [] };
    const effects = new Map();
    const effect = (s) => {
        let e = effects.get(s.stream_id);
        if (!e) {
            e = { direction: s.direction, stream_id: s.stream_id, release: [], item_ids: [], remove_pending: [] };
            effects.set(s.stream_id, e);
        }
        return e;
    };
    const suppress = (ids) => base_change.add_suppressed.push(...ids);
    // Same-bill pool + "stopped in this sync" (returned inactive, or a stale candidate).
    const pool_by_id = new Map();
    for (const r of [...((_b = (_a = input.same_bill) === null || _a === void 0 ? void 0 : _a.candidates) !== null && _b !== void 0 ? _b : []), ...input.existing.values()])
        pool_by_id.set(r.id, r);
    const same_bill_pool = [...pool_by_id.values()];
    const stopped_in_sync = new Set([
        ...input.streams.filter((x) => x.raw_is_active === false && input.existing.has(x.stream_id)).map((x) => x.stream_id),
        ...input.stale_candidates.map((r) => r.id),
    ]);
    const same_bill_ctx = {
        active_account_ids: (_d = (_c = input.same_bill) === null || _c === void 0 ? void 0 : _c.active_account_ids) !== null && _d !== void 0 ? _d : new Set(),
        stopped_in_sync,
    };
    // This item's pending "Track" / "Keep separate" answers by their stream (round 4 test 7): the
    // stream is tracked by ID, so a vendor rename (merchant renamed → a new vendor key, a new tile)
    // still creates the bill the user asked for instead of leaving the track pending forever.
    const pending_by_stream = new Map();
    for (const pt of (_f = (_e = input.state) === null || _e === void 0 ? void 0 : _e.pending_tracks) !== null && _f !== void 0 ? _f : []) {
        if (pt.plaid_item_doc_id !== input.plaid_item_doc_id || !pt.stream_id || typeof pt.handed_off_ms === "number")
            continue;
        const it = input.review_items.get(pt.item_id);
        if (it && it.status === "resolved" && (it.answer === "track" || it.answer === "keep_separate" || it.answer === "same_bill"))
            pending_by_stream.set(pt.stream_id, it);
    }
    for (const s of input.streams) {
        const ex = input.existing.get(s.stream_id);
        // ── Existing OLD record: today's path, untouched.
        if (ex && !ex.v2) {
            if (s.entity)
                save(s, s.entity);
            continue;
        }
        // ── Existing v2 record: always kept, ours to turn on and off.
        if (ex && ex.v2) {
            if (!s.entity)
                continue; // rejected: not saved (invalid), never stale-marked (X10)
            const unknown_freq = (0, capture_rules_1.is_low_confidence_stream)("MATURE", s.raw_frequency);
            const saved_entity = Object.assign(Object.assign(Object.assign({}, s.entity), { is_active: ex.is_active, plaid_is_active: s.raw_is_active }), (unknown_freq ? { frequency: ex.frequency } : {}));
            save(s, saved_entity, true);
            const cur = as_saved(ex, s, saved_entity);
            const open = item_at("still_a_bill", ex.id);
            if ((open === null || open === void 0 ? void 0 : open.status) === "open" && !is_shown(ex, input.now_ms)) {
                // The user removed / paused / merged the bill meanwhile: the question is moot — closed,
                // never refreshed (defect 5; no tile for a bill that isn't shown).
                plan.review_items.push((0, review_item_service_1.resolve_review_item)(open, "not_shown", input.now_ms));
            }
            else if (s.raw_is_active === false) {
                const changed = ex.plaid_is_active !== false;
                if ((open === null || open === void 0 ? void 0 : open.status) === "open") {
                    plan.review_items.push(still_a_bill_item(input, cur, open)); // keep (refresh) the question
                }
                else if ((changed || reopens(open)) && is_shown(ex, input.now_ms) && ex.plaid_inactive_ack_ms === null && !(0, review_item_service_1.is_user_answered)(open)) {
                    plan.review_items.push(still_a_bill_item(input, cur, open));
                }
            }
            else if ((open === null || open === void 0 ? void 0 : open.status) === "open") {
                plan.review_items.push((0, review_item_service_1.resolve_review_item)(open, "auto_active", input.now_ms)); // Plaid back on
            }
            continue;
        }
        // ── New stream.
        if (!s.entity)
            continue; // rejected and no record: nothing to do (as today)
        // Absorb, never save (D3 / D42): the same bill as a converted record → recorded on it, not saved.
        // Independent of the flag (D16: the record decides).
        const absorber = (0, absorb_service_1.find_absorber)(s, stream_vendor(s), same_bill_pool);
        if (absorber) {
            const taken = (0, absorb_service_1.plan_absorb)(absorber, s, input.now_ms, in_response_stream_ids, absorb_writes.get(absorber.id));
            if (taken !== "declined" && taken !== "full") {
                if (taken)
                    absorb_writes.set(absorber.id, taken);
                // The stream counts as handled: its held-out payments are released and a pending track of
                // the vendor is fulfilled — as if its bill had been saved.
                saved_ids.add(s.stream_id);
                const subject = (0, review_item_service_1.suggested_subject)(s.direction, stream_vendor(s));
                if (!saved_by_subject.has(subject))
                    saved_by_subject.set(subject, s);
                effect(s).release.push(...s.transaction_ids);
                continue;
            }
            // declined (the user undid the absorb) or no room: the stream is handled as any new stream
        }
        if (!input.flag_on) {
            // A vendor the user said "Not a bill" for — or whose converted bill they deleted, which
            // records the same memory so its absorbed stream never returns as a new Plaid bill (P9) — stays
            // skipped even with the flag off (the memory is the user's, not the flag's).
            if ((0, review_item_service_1.is_vendor_dismissed)(input.state, s.direction, stream_vendor(s))) {
                suppress(s.transaction_ids);
                continue;
            }
            save(s, s.entity); // today's handling (no stamp)
            continue;
        }
        if (s.raw_is_active === false) {
            save(s, s.entity); // X2: a stream first seen inactive keeps today's handling
            continue;
        }
        const vk = stream_vendor(s);
        const suggested = item_at("suggested", (0, review_item_service_1.suggested_subject)(s.direction, vk));
        const same_bill = item_at("same_bill", s.stream_id);
        const pending_item = pending_by_stream.get(s.stream_id);
        const tracked = (suggested && suggested.answer === "track" && suggested.status === "resolved") ||
            (same_bill && (same_bill.answer === "keep_separate" || same_bill.answer === "same_bill") && same_bill.status === "resolved") ||
            !!pending_item;
        if (tracked) {
            const picked = (suggested === null || suggested === void 0 ? void 0 : suggested.answer) === "track" && suggested.status === "resolved"
                ? suggested.user_frequency
                : (pending_item === null || pending_item === void 0 ? void 0 : pending_item.answer) === "track"
                    ? pending_item.user_frequency
                    : null;
            // "Same bill" (D7 / D22): the new bill continues the old one — it inherits the user's name,
            // expected amount and schedule IN ITS CREATE PAYLOAD (a later update would re-materialize
            // every period: the amount trigger has no by-sync guard).
            const merged_from = (_g = [same_bill, pending_item].find((it) => (it === null || it === void 0 ? void 0 : it.answer) === "same_bill" && it.status === "resolved")) === null || _g === void 0 ? void 0 : _g.record_id;
            const old = merged_from ? pool_by_id.get(merged_from) : undefined;
            create_v2(s, (_h = picked !== null && picked !== void 0 ? picked : old === null || old === void 0 ? void 0 : old.user_frequency) !== null && _h !== void 0 ? _h : null, old);
            // The answered item's held-out payments are released now that the bill exists (not at
            // answer time — fix round: the hold-out must cover the gap until creation).
            // Only the item's OWN stream releases its ids (another item's stream of the same vendor
            // may be tracked too; the item's stream is resolved by its pending track, defect 4).
            for (const it of new Set([suggested, same_bill, pending_item])) {
                if (it && it.status === "resolved" && it.source === "plaid" && it.stream_id === s.stream_id) {
                    effect(s).release.push(...it.transaction_ids);
                }
            }
            continue;
        }
        if ((0, capture_rules_1.is_tombstoned_stream)(s.raw_status)) {
            suppress(s.transaction_ids); // D17: skipped — and never fuzzy-linked to an old bill (X3)
            continue;
        }
        if ((0, review_item_service_1.is_vendor_dismissed)(input.state, s.direction, vk) || (suggested === null || suggested === void 0 ? void 0 : suggested.answer) === "not_bill") {
            suppress(s.transaction_ids); // "Not a bill" is remembered, maturity included (X14)
            // A tile left OPEN for a vendor the user dismissed (written by a racing writer before the
            // guard, or by the detector) is closed as dismissed — it would otherwise stay forever.
            if ((suggested === null || suggested === void 0 ? void 0 : suggested.status) === "open")
                plan.review_items.push((0, review_item_service_1.resolve_review_item)(suggested, "not_bill", input.now_ms));
            continue;
        }
        if ((0, capture_rules_1.is_low_confidence_stream)(s.raw_status, s.raw_frequency)) {
            suppress(s.transaction_ids);
            if ((0, capture_rules_1.may_suggest_stream)(s.direction, s.detailed_category, s.account_type)) {
                // Built after the loop, ONE stream per vendor chosen deterministically (defect 2).
                suggest_candidates.push({ s, subject: (0, review_item_service_1.suggested_subject)(s.direction, vk), existing: suggested });
            }
            continue;
        }
        // Same bill? A new stream replacing a bill that STOPPED is held as a question, not a second
        // bill (D7, D10: no double count while unanswered). Two active streams never match.
        const replaced = (0, same_bill_service_1.find_replaced_record)(s, vk, same_bill_pool, same_bill_ctx);
        if (replaced) {
            suppress(s.transaction_ids);
            plan.review_items.push(same_bill_item(input, s, replaced, same_bill));
            continue;
        }
        if (input.same_bill && !input.same_bill.inactive_loaded)
            plan.wants_inactive_records = true;
        // Mature, known schedule, active → a v2 record.
        create_v2(s, null);
        if ((suggested === null || suggested === void 0 ? void 0 : suggested.status) === "open") {
            // Closed after the loop — unless another low-confidence stream of the vendor keeps it.
            matured.set((0, review_item_service_1.suggested_subject)(s.direction, vk), { item: suggested, s });
        }
    }
    // ── Suggested tiles: one per vendor, built from ONE stream chosen deterministically (review
    //    round 3 defect 2). Items are keyed per vendor but built from a single stream, so two Plaid
    //    items with an early stream of the same vendor (or a reordered stream list) overwrote each
    //    other on every sync. Now:
    //      - a vendor whose stream matured into a bill this sync: its open tile is closed "matured"
    //        — unless another of its streams is still low-confidence, which then keeps the tile
    //        (closing it here only for the next sync to reopen it flip-flopped; Top-25 #23);
    //      - an OPEN tile owned by ANOTHER Plaid item's stream is left as it is (that item's sync
    //        maintains it; this sync can't see that stream);
    //      - otherwise the tile keeps its stored stream while that stream is in this response, else
    //        takes the smallest stream id — the same input always builds the same item.
    const by_subject = new Map();
    for (const c of suggest_candidates) {
        if (!by_subject.has(c.subject))
            by_subject.set(c.subject, []);
        by_subject.get(c.subject).push(c);
    }
    // An OPEN tile owned by ANOTHER Plaid item's stream (round 4 defect 1): that item's stream is
    // still low-confidence (its sync keeps the tile) — this item's stream maturing must not close
    // it (the other item's next sync reopened it: a close + reopen on every pair of syncs).
    const owned_elsewhere = (ex) => !!ex && ex.status === "open" && ex.source === "plaid" && !!ex.plaid_item_doc_id &&
        ex.plaid_item_doc_id !== input.plaid_item_doc_id;
    for (const [subject, m] of matured) {
        if (by_subject.has(subject))
            continue; // still suggested via another stream (below)
        if (owned_elsewhere(m.item))
            continue;
        const closed = (0, review_item_service_1.resolve_review_item)(m.item, "matured", input.now_ms);
        plan.review_items.push(closed);
        effect(m.s).item_ids.push(closed.id);
        effect(m.s).release.push(...m.item.transaction_ids);
    }
    for (const [, group] of by_subject) {
        const ex = group[0].existing;
        if (owned_elsewhere(ex))
            continue;
        const sorted = [...group].sort((a, b) => (a.s.stream_id < b.s.stream_id ? -1 : a.s.stream_id > b.s.stream_id ? 1 : 0));
        const pick = ((ex === null || ex === void 0 ? void 0 : ex.stream_id) && sorted.find((c) => c.s.stream_id === ex.stream_id)) || sorted[0];
        plan.review_items.push(suggested_item(input, pick.s, ex));
    }
    // ── Let go of this item's tiles whose stream it no longer sees (round 4 defect 2). An OPEN
    //    Plaid tile owned by this item, not rebuilt or closed above, whose stream isn't in this
    //    response: no sync will ever see that stream again, and another item's live stream of the
    //    vendor can't take a tile this item owns. Closed `stream_gone` (a system close: the vendor's
    //    next live stream reopens it, owned by its item); its held-out payments are released.
    //    Round 5 defects 1 + 2: a stream still IN the response but no longer a suggest candidate for
    //    the tile's OWN subject — tombstoned, an invalid entity, first seen inactive, or renamed to
    //    another vendor (merchant rename: it now builds the new vendor's tile) — lets go of the tile
    //    too. Skipping it on "in the response" left the tile open, dropped from the owners list
    //    (it wasn't rebuilt), so once the stream vanished no sync loaded it again: stranded open
    //    forever, and no other item's live stream could take it over; after a rename it stayed a
    //    second open tile of the same stream. With the flag off no candidates are built at all, so
    //    "in the response" still keeps the tile as it is (today's handling).
    const in_response_ids = new Set(input.streams.map((x) => x.stream_id));
    const candidate_for = (it) => suggest_candidates.some((c) => c.s.stream_id === it.stream_id && c.subject === it.subject_key);
    const planned = new Set(plan.review_items.map((i) => i.id));
    // Payments held out again this round (the renamed vendor's new tile, a tombstoned stream — D17)
    // stay held: only the rest of the let-go tile's ids are released.
    const held_now = new Set(base_change.add_suppressed);
    for (const it of input.review_items.values()) {
        if (it.kind !== "suggested" || it.status !== "open" || it.source !== "plaid")
            continue;
        if (it.plaid_item_doc_id !== input.plaid_item_doc_id || planned.has(it.id))
            continue;
        if (it.stream_id && in_response_ids.has(it.stream_id) && (!input.flag_on || candidate_for(it)))
            continue;
        plan.review_items.push((0, review_item_service_1.resolve_review_item)(it, "stream_gone", input.now_ms));
        base_change.remove_suppressed.push(...it.transaction_ids.filter((id) => !held_now.has(id)));
    }
    function create_v2(s, user_frequency, inherit) {
        save(s, Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, s.entity), ((inherit === null || inherit === void 0 ? void 0 : inherit.custom_name) ? { user_custom_name: inherit.custom_name } : {})), ((inherit === null || inherit === void 0 ? void 0 : inherit.expected_amount_override) != null ? { expected_amount_override: inherit.expected_amount_override } : {})), { capture_rules_version: capture_rules_1.CAPTURE_RULES_VERSION, plaid_is_active: true }), (s.direction === "inflow" && (0, capture_rules_1.is_card_payment_inflow)(s.detailed_category) ? { is_hidden: true } : {})), (user_frequency ? { user_frequency: user_frequency } : {})), true);
    }
    // ── Stale candidates (this item's active records Plaid didn't return as valid).
    const in_response = new Set(input.streams.map((s) => s.stream_id));
    for (const r of input.stale_candidates) {
        if (!r.v2) {
            // A record merged into another bill (D41) is exempt: Plaid never stales it.
            if (!r.merged_into_id)
                (r.direction === "outflow" ? plan.stale_outflow_ids : plan.stale_inflow_ids).push(r.id);
            continue;
        }
        if (in_response.has(r.id))
            continue; // v2 + rejected: kept as is (gap 8 / X10)
        // v2 + Plaid stopped returning it → Plaid's opinion recorded; the user is asked (D19).
        if (r.plaid_is_active !== false) {
            (r.direction === "outflow" ? plan.plaid_inactive_outflow_ids : plan.plaid_inactive_inflow_ids).push(r.id);
        }
        const open = item_at("still_a_bill", r.id);
        if ((open === null || open === void 0 ? void 0 : open.status) === "open" && !is_shown(r, input.now_ms)) {
            plan.review_items.push((0, review_item_service_1.resolve_review_item)(open, "not_shown", input.now_ms)); // moot (defect 5)
        }
        else if ((open === null || open === void 0 ? void 0 : open.status) === "open") {
            plan.review_items.push(still_a_bill_item(input, r, open));
        }
        else if ((r.plaid_is_active !== false || reopens(open)) && is_shown(r, input.now_ms) && r.plaid_inactive_ack_ms === null && !(0, review_item_service_1.is_user_answered)(open)) {
            plan.review_items.push(still_a_bill_item(input, r, open));
        }
    }
    // ── Pending tracks of THIS Plaid item (defect 4): every "Track" / "Keep separate" gets an
    //    outcome. Its stream saved (v2 — or unstamped: flag off at the re-sync / first seen
    //    inactive) → the bill exists: fulfilled, its payments released with the save. Its stream gone
    //    from the response, rejected, or on a removed account → no bill can be made: the payments
    //    are released (normal transactions again) and the item is closed `track_unavailable` (a
    //    system close: the vendor may be suggested again if Plaid brings it back).
    const by_stream = new Map(input.streams.map((x) => [x.stream_id, x]));
    const record_vendor = (r) => (0, vendor_key_service_1.vendor_key)({ merchant_name: r.merchant_name, name: r.description });
    // A bill of the vendor that exists already (made by another item's sync, say) fulfils the track.
    const has_vendor_bill = (it) => !!it.vendor_key &&
        same_bill_pool.some((r) => r.v2 && r.is_active && !r.merged_into_id && r.direction === it.direction && record_vendor(r) === it.vendor_key);
    const handoff = new Set();
    const close_unavailable = (pt, item, s) => {
        var _a;
        base_change.remove_pending_track_ids.push(pt.item_id);
        if (!item)
            return;
        base_change.remove_suppressed.push(...item.transaction_ids, ...((_a = s === null || s === void 0 ? void 0 : s.transaction_ids) !== null && _a !== void 0 ? _a : []));
        if (item.status === "resolved" && (item.answer === "track" || item.answer === "keep_separate")) {
            plan.review_items.push((0, review_item_service_1.resolve_review_item)(item, "track_unavailable", input.now_ms));
        }
    };
    for (const pt of (_k = (_j = input.state) === null || _j === void 0 ? void 0 : _j.pending_tracks) !== null && _k !== void 0 ? _k : []) {
        const handed_off = typeof pt.handed_off_ms === "number";
        if (!handed_off && pt.plaid_item_doc_id !== input.plaid_item_doc_id)
            continue;
        const item = input.review_items.get(pt.item_id);
        const s = !handed_off && pt.stream_id ? by_stream.get(pt.stream_id) : undefined;
        if (s && saved_ids.has(s.stream_id)) {
            effect(s).remove_pending.push(pt.item_id);
            if (item)
                effect(s).release.push(...item.transaction_ids);
            continue;
        }
        const aged = input.now_ms - pt.since_ms >= review_item_service_1.PENDING_TRACK_MAX_AGE_MS;
        if (s && s.entity && !aged)
            continue; // still pending (backstop: never forever)
        // Its own stream is gone / rejected (or the track was handed off): another stream of the same
        // vendor saved this round, or a bill of the vendor that already exists, fulfils it (defect 2).
        const subject = (item === null || item === void 0 ? void 0 : item.vendor_key) ? (0, review_item_service_1.suggested_subject)(item.direction, item.vendor_key) : null;
        const by_vendor = subject ? saved_by_subject.get(subject) : undefined;
        if (item && by_vendor) {
            effect(by_vendor).remove_pending.push(pt.item_id);
            effect(by_vendor).release.push(...item.transaction_ids);
            continue;
        }
        if (item && has_vendor_bill(item)) {
            base_change.remove_pending_track_ids.push(pt.item_id);
            base_change.remove_suppressed.push(...item.transaction_ids);
            continue;
        }
        if (handed_off) {
            // Waiting on the user's other items: this one has synced without the vendor.
            const awaiting = ((_l = pt.awaiting_item_doc_ids) !== null && _l !== void 0 ? _l : []).filter((id) => id !== input.plaid_item_doc_id);
            if (awaiting.length === 0 || input.now_ms - pt.handed_off_ms >= review_item_service_1.PENDING_HANDOFF_TTL_MS) {
                close_unavailable(pt, item, undefined);
            }
            else if (awaiting.length !== ((_m = pt.awaiting_item_doc_ids) !== null && _m !== void 0 ? _m : []).length) {
                ((_o = base_change.add_pending_tracks) !== null && _o !== void 0 ? _o : (base_change.add_pending_tracks = [])).push(Object.assign(Object.assign({}, pt), { awaiting_item_doc_ids: awaiting }));
            }
            continue;
        }
        // Gone from THIS item: another of the user's Plaid items may have a live stream of the vendor
        // (the tile could be owned by a stream that vanished) — hand the track to them, never lose it.
        const others = ((_p = input.other_item_doc_ids) !== null && _p !== void 0 ? _p : []).filter((id) => id !== input.plaid_item_doc_id);
        if (item && others.length > 0 && !aged) {
            ((_q = base_change.add_pending_tracks) !== null && _q !== void 0 ? _q : (base_change.add_pending_tracks = [])).push(Object.assign(Object.assign({}, pt), { plaid_item_doc_id: null, handed_off_ms: input.now_ms, awaiting_item_doc_ids: [...others].sort() }));
            for (const id of others)
                handoff.add(id);
            continue;
        }
        if (item && !aged && input.other_item_doc_ids === undefined)
            plan.wants_other_items = true;
        close_unavailable(pt, item, s);
    }
    if (handoff.size > 0)
        plan.handoff_item_doc_ids = [...handoff].sort();
    // ── The open suggested tiles this item now owns (defect 2): stored only when they changed.
    //    Round 5 defect 1: from the FINAL view — the loaded items overlaid by this plan's — so a tile
    //    this item still owns and leaves open (not rebuilt this sync) stays on the list, and the
    //    item's next sync can always load it (close it / let it go) once its stream is gone.
    const final_view = new Map(input.review_items);
    for (const i of plan.review_items)
        final_view.set(i.id, i);
    const owned_now = [...final_view.values()]
        .filter((i) => i.kind === "suggested" && i.status === "open" && i.source === "plaid" && i.plaid_item_doc_id === input.plaid_item_doc_id)
        .map((i) => i.id).sort();
    const owned_before = ((_s = (_r = input.state) === null || _r === void 0 ? void 0 : _r.suggested_owners) !== null && _s !== void 0 ? _s : [])
        .filter((o) => o.plaid_item_doc_id === input.plaid_item_doc_id).map((o) => o.item_id).sort();
    if (owned_now.join("\n") !== owned_before.join("\n")) {
        base_change.set_suggested_owners = { plaid_item_doc_id: input.plaid_item_doc_id, item_ids: owned_now };
    }
    // Round 5: owner entries of a Plaid item the user no longer has are dropped — only when this
    // sync already loaded the user's items (no extra read for it).
    if (input.other_item_doc_ids !== undefined) {
        const live = new Set([input.plaid_item_doc_id, ...input.other_item_doc_ids]);
        if (((_u = (_t = input.state) === null || _t === void 0 ? void 0 : _t.suggested_owners) !== null && _u !== void 0 ? _u : []).some((o) => !live.has(o.plaid_item_doc_id))) {
            base_change.keep_owner_item_doc_ids = [...live].sort();
        }
    }
    // Ids both suppressed and saved this round end saved (stream membership wins).
    if (absorb_writes.size > 0)
        plan.absorbs = [...absorb_writes.values()].sort((a, b) => (a.record_id < b.record_id ? -1 : 1));
    plan.base_change = base_change;
    plan.save_effects = [...effects.values()];
    plan.state_change = compose_state_change(base_change, plan.save_effects);
    return plan;
}
//# sourceMappingURL=recurring_capture_planner.service.js.map