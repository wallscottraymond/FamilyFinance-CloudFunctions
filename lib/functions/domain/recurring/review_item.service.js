"use strict";
/**
 * Bills-to-review items + the per-user review state (Convert-To-Recurring Phase 1, D9 / D14 / X8).
 *
 * REVIEW ITEMS (`recurring_review_items`) are what the app shows: one per (owner, kind, subject),
 * at a DETERMINISTIC id so every writer is idempotent with no exists-query and every reader can
 * `getAll` the ids of the subjects it has in hand (X8):
 *   - `suggested`    — a possible bill / income (Plaid low-confidence stream, or the detector);
 *                      subject = direction + VENDOR KEY (X14: one tile per vendor, whatever found it)
 *   - `still_a_bill` — a v2 bill Plaid turned off / stopped returning; subject = the record id
 *   - `same_bill`    — a new Plaid stream that looks like a stopped bill's replacement; subject =
 *                      the new stream id
 * Vendor keys can contain "/" (e.g. "paypal /inst xfer"), so subjects are HASHED into the id.
 *
 * REVIEW STATE (`_recurring_review_state/{uid}`, server-only) is what the backend must remember:
 * the Plaid transaction ids held out of fuzzy bill matching (open + dismissed suggestions, X3),
 * the "Not a bill" vendor keys (D11), and the detector's daily throttle. One `get` per reader;
 * written only when its content changes.
 *
 * PURE: no IO (hashing is deterministic).
 *
 * @module domain/recurring/review_item
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYSTEM_CLOSE_ANSWERS = exports.RESOLVED_ITEM_TTL_MS = exports.PENDING_TRACK_MAX_AGE_MS = exports.PENDING_HANDOFF_TTL_MS = exports.MAX_SUGGESTED_OWNERS = exports.MAX_PENDING_TRACKS = exports.MAX_ITEM_TRANSACTION_IDS = exports.MAX_DISMISSED_VENDOR_KEYS = exports.MAX_SUPPRESSED_TXN_IDS = void 0;
exports.suggested_subject = suggested_subject;
exports.build_review_item_id = build_review_item_id;
exports.owner_of_review_item_id = owner_of_review_item_id;
exports.review_content_hash = review_content_hash;
exports.make_review_item = make_review_item;
exports.changed_items = changed_items;
exports.is_user_answered = is_user_answered;
exports.may_background_write = may_background_write;
exports.resolve_review_item = resolve_review_item;
exports.empty_review_state = empty_review_state;
exports.suppressed_hash = suppressed_hash;
exports.apply_review_state_change = apply_review_state_change;
exports.cap_suppressed_ids = cap_suppressed_ids;
exports.is_vendor_dismissed = is_vendor_dismissed;
exports.utc_day = utc_day;
const crypto_1 = require("crypto");
/**
 * Bounds (CLAUDE.md write rule 9: every array field has a prune policy). The held-out ids are
 * capped DETERMINISTICALLY (review round 3 defect 6): the set is kept sorted and the first
 * MAX_SUPPRESSED_TXN_IDS ids are kept, so identical input always yields the identical stored set
 * — an insertion-order cap evicted a different subset each sync (each re-added id pushed another
 * out: a write + a derive bump + a re-assign on every sync). Vendor keys only ever grow by a
 * user's tap; their cap drops the oldest.
 */
exports.MAX_SUPPRESSED_TXN_IDS = 5000;
exports.MAX_DISMISSED_VENDOR_KEYS = 1000;
exports.MAX_ITEM_TRANSACTION_IDS = 60;
exports.MAX_PENDING_TRACKS = 200;
exports.MAX_SUGGESTED_OWNERS = 1000;
/** A handed-off track no other item fulfilled within this is closed `track_unavailable`. */
exports.PENDING_HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Backstop: no track stays pending longer than this (round 4 test 7 — never pending forever). */
exports.PENDING_TRACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Resolved items expire (console TTL policy on `expireAt`); open + dismissed never carry it. */
exports.RESOLVED_ITEM_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const sha1 = (s) => (0, crypto_1.createHash)("sha1").update(s).digest("hex");
/** The subject a `suggested` item is keyed by: direction + vendor key (X14). */
function suggested_subject(direction, vendor_key) {
    return `${direction}:${vendor_key}`;
}
/** Deterministic review-item id: `${uid}__${kind}__${sha1(subject)[0..24]}` (subjects may hold "/"). */
function build_review_item_id(user_id, kind, subject_key) {
    return `${user_id}__${kind}__${sha1(subject_key).slice(0, 24)}`;
}
/** Parse the owner uid out of an item id (the prefix before the first `__`). */
function owner_of_review_item_id(item_id) {
    const i = item_id.indexOf("__");
    return i > 0 ? item_id.slice(0, i) : null;
}
/** The fields that, when changed, make an item worth rewriting (timestamps excluded). */
function review_content_hash(item) {
    return sha1(JSON.stringify([
        item.user_id, item.kind, item.direction, item.source, item.status, item.answer,
        item.subject_key, item.vendor_key, item.account_id, item.plaid_item_doc_id, item.stream_id,
        item.record_id, item.name, Math.round(item.amount * 100), item.frequency, item.plaid_status,
        item.category, [...item.transaction_ids].sort(), item.next_due_ms, item.user_frequency,
        item.resolved_at_ms,
    ]));
}
/** Build a complete item from its parts (id + hash computed). */
function make_review_item(parts, now_ms, existing) {
    var _a;
    // Sorted BEFORE the cap (round 4 test 8): capping Plaid's order kept a different 60 of a longer
    // list each time Plaid reordered it — a rewrite per sync. Same input set → same stored ids.
    const transaction_ids = [...new Set(parts.transaction_ids)].sort().slice(-exports.MAX_ITEM_TRANSACTION_IDS);
    const body = Object.assign(Object.assign({}, parts), { transaction_ids });
    return Object.assign(Object.assign({}, body), { id: build_review_item_id(parts.user_id, parts.kind, parts.subject_key), content_hash: review_content_hash(body), created_at_ms: (_a = existing === null || existing === void 0 ? void 0 : existing.created_at_ms) !== null && _a !== void 0 ? _a : now_ms, updated_at_ms: now_ms });
}
/** Only items whose content changed are written (X8 / R5: an identical re-sync writes nothing). */
function changed_items(next, existing) {
    var _a;
    const seen = new Set();
    const out = [];
    for (const item of next) {
        if (seen.has(item.id))
            continue;
        seen.add(item.id);
        if (((_a = existing.get(item.id)) === null || _a === void 0 ? void 0 : _a.content_hash) === item.content_hash)
            continue;
        out.push(item);
    }
    return out;
}
/** Answers the system writes itself — an item closed this way may open again. */
exports.SYSTEM_CLOSE_ANSWERS = new Set([
    "matured", "auto_active", "account_removed", "track_unavailable", "not_shown", "stream_gone",
]);
/** Has the USER answered this item (closed with a user answer)? A background writer (sync,
 *  detector, account removal) never overwrites such an item (review round 3 defect 1). */
function is_user_answered(item) {
    return !!item && item.status !== "open" && !!item.answer && !exports.SYSTEM_CLOSE_ANSWERS.has(item.answer);
}
/**
 * Which of `next` a BACKGROUND writer may write, judged against the item as it is NOW (`current`,
 * read in the writer's transaction) and as the writer saw it when it planned (`seen`):
 *   - changed since it was read (another writer — an answer, a racing sync — got there first) →
 *     skip; the next run plans from the fresh item;
 *   - created since (not seen, now exists) or deleted since (seen, now gone — e.g. purged) → skip;
 *   - answered by the user → never overwritten.
 * PURE (review round 3 defect 1: a sync planned from an earlier read reverted "Not a bill" /
 * "Track" to open).
 */
function may_background_write(current, seen, next) {
    if (!current)
        return !seen;
    if (!seen || seen.content_hash !== current.content_hash || seen.updated_at_ms !== current.updated_at_ms)
        return false;
    // The one system write over a user's answer: a "Track" / "Keep separate" whose bill could not
    // be made is closed with that outcome (defect 4) — never reopened.
    if ((next === null || next === void 0 ? void 0 : next.answer) === "track_unavailable")
        return current.answer === "track" || current.answer === "keep_separate";
    return !is_user_answered(current);
}
/** Close an item with an answer (status from the answer). */
function resolve_review_item(item, answer, now_ms, extra) {
    var _a;
    const status = answer === "not_bill" ? "dismissed" : "resolved";
    return make_review_item(Object.assign(Object.assign({}, item), { status,
        answer, user_frequency: (_a = extra === null || extra === void 0 ? void 0 : extra.user_frequency) !== null && _a !== void 0 ? _a : item.user_frequency, resolved_at_ms: now_ms }), now_ms, item);
}
function empty_review_state(user_id) {
    return {
        user_id, suppressed_txn_ids: [], dismissed_vendor_keys: [], detector_last_run_day: null, pending_tracks: [],
        suggested_owners: [],
    };
}
/** Hash of the derive-relevant part of the state: only the suppressed ids feed the derive. */
function suppressed_hash(state) {
    var _a;
    return sha1([...((_a = state === null || state === void 0 ? void 0 : state.suppressed_txn_ids) !== null && _a !== void 0 ? _a : [])].sort().join(","));
}
/**
 * Apply a change to the state. Returns the next state and what changed: `changed` → write it;
 * `suppressed_changed` → the derive's input changed too (bump the derive version, X3). PURE.
 */
function apply_review_state_change(current, user_id, change) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const base = current !== null && current !== void 0 ? current : empty_review_state(user_id);
    const remove = new Set((_a = change.remove_suppressed) !== null && _a !== void 0 ? _a : []);
    const have = new Set(base.suppressed_txn_ids.filter((id) => !remove.has(id)));
    for (const id of (_b = change.add_suppressed) !== null && _b !== void 0 ? _b : [])
        have.add(id);
    const suppressed = cap_suppressed_ids([...have]);
    const forget = new Set((_c = change.remove_dismissed_vendor_keys) !== null && _c !== void 0 ? _c : []);
    const dismissed = base.dismissed_vendor_keys.filter((k) => !forget.has(k));
    const have_d = new Set(dismissed);
    for (const k of (_d = change.add_dismissed_vendor_keys) !== null && _d !== void 0 ? _d : []) {
        if (!have_d.has(k)) {
            dismissed.push(k);
            have_d.add(k);
        }
    }
    const drop_pending = new Set([
        ...((_e = change.remove_pending_track_ids) !== null && _e !== void 0 ? _e : []),
        ...((_f = change.add_pending_tracks) !== null && _f !== void 0 ? _f : []).map((p) => p.item_id),
    ]);
    // Round 5 test 7: two awaited Plaid items syncing at the same time each plan "the others, minus
    // me" from the SAME state — applied (in a transaction, one after the other) the second would put
    // back the first item. The SAME hand-off (same handed_off_ms) only ever shrinks: its awaited
    // items are the intersection, so the track ends with nobody awaited and the next sync of any
    // item closes it (or a live stream / bill of the vendor fulfils it first).
    const base_pending = new Map(((_g = base.pending_tracks) !== null && _g !== void 0 ? _g : []).map((p) => [p.item_id, p]));
    const narrowed = (p) => {
        var _a, _b;
        const q = base_pending.get(p.item_id);
        if (!q || typeof q.handed_off_ms !== "number" || q.handed_off_ms !== p.handed_off_ms)
            return p;
        const still = new Set((_a = q.awaiting_item_doc_ids) !== null && _a !== void 0 ? _a : []);
        return Object.assign(Object.assign({}, p), { awaiting_item_doc_ids: ((_b = p.awaiting_item_doc_ids) !== null && _b !== void 0 ? _b : []).filter((id) => still.has(id)) });
    };
    const pending = [
        ...((_h = base.pending_tracks) !== null && _h !== void 0 ? _h : []).filter((p) => !drop_pending.has(p.item_id)),
        ...((_j = change.add_pending_tracks) !== null && _j !== void 0 ? _j : []).map(narrowed),
    ].slice(-exports.MAX_PENDING_TRACKS);
    const owners_change = change.set_suggested_owners;
    const keep_items = change.keep_owner_item_doc_ids ? new Set(change.keep_owner_item_doc_ids) : null;
    const owners_in = [
        ...((_k = base.suggested_owners) !== null && _k !== void 0 ? _k : []).filter((o) => !owners_change || o.plaid_item_doc_id !== owners_change.plaid_item_doc_id),
        ...(owners_change ? [...new Set(owners_change.item_ids)].map((item_id) => ({ item_id, plaid_item_doc_id: owners_change.plaid_item_doc_id })) : []),
    ].filter((o) => !keep_items || keep_items.has(o.plaid_item_doc_id));
    // Round 5: one deterministic order (Plaid item, then tile) and cap — the same owners always
    // store the same list whichever item wrote last (an insertion-order cap let two items evict
    // each other's entries on every sync: a rewrite war). Untouched → stored as is (no rewrite).
    const owners = owners_change || keep_items
        ? [...owners_in].sort((a, b) => cmp(a.plaid_item_doc_id, b.plaid_item_doc_id) || cmp(a.item_id, b.item_id)).slice(0, exports.MAX_SUGGESTED_OWNERS)
        : (_l = base.suggested_owners) !== null && _l !== void 0 ? _l : [];
    const next = {
        user_id,
        suppressed_txn_ids: suppressed,
        dismissed_vendor_keys: dismissed.slice(-exports.MAX_DISMISSED_VENDOR_KEYS),
        detector_last_run_day: (_m = change.detector_last_run_day) !== null && _m !== void 0 ? _m : base.detector_last_run_day,
        pending_tracks: pending,
        suggested_owners: owners,
    };
    const suppressed_changed = suppressed_hash(next) !== suppressed_hash(current);
    const pending_key = (list) => JSON.stringify(list !== null && list !== void 0 ? list : []);
    const changed = !current ||
        suppressed_changed ||
        next.dismissed_vendor_keys.join("\n") !== base.dismissed_vendor_keys.join("\n") ||
        next.detector_last_run_day !== base.detector_last_run_day ||
        pending_key(next.pending_tracks) !== pending_key(base.pending_tracks) ||
        JSON.stringify((_o = next.suggested_owners) !== null && _o !== void 0 ? _o : []) !== JSON.stringify((_p = base.suggested_owners) !== null && _p !== void 0 ? _p : []);
    // A brand-new state that holds nothing is not worth a write.
    const is_empty = next.suppressed_txn_ids.length === 0 &&
        next.dismissed_vendor_keys.length === 0 &&
        next.detector_last_run_day === null &&
        pending.length === 0 &&
        owners.length === 0;
    return { next, changed: changed && !(current === null && is_empty), suppressed_changed };
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** The deterministic held-out cap: sorted, first MAX_SUPPRESSED_TXN_IDS kept (defect 6). PURE. */
function cap_suppressed_ids(ids) {
    return [...new Set(ids)].sort().slice(0, exports.MAX_SUPPRESSED_TXN_IDS);
}
/** Is this vendor remembered as "Not a bill" / "Not income" for the user? */
function is_vendor_dismissed(state, direction, vendor_key) {
    if (!state || !vendor_key)
        return false;
    return state.dismissed_vendor_keys.includes(suggested_subject(direction, vendor_key));
}
/** UTC day key `YYYY-MM-DD`. */
function utc_day(now_ms) {
    return new Date(now_ms).toISOString().slice(0, 10);
}
//# sourceMappingURL=review_item.service.js.map