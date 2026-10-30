"use strict";
/**
 * Recurring Review Repository (Convert-To-Recurring Phase 1)
 *
 * Two collections:
 *   - `recurring_review_items/{uid}__{kind}__{hash}` — the "Bills to review" items the app listens
 *     to (owner read only, no client writes). NO trigger listens to this collection (R7).
 *   - `_recurring_review_state/{uid}` — server-only memory (suppressed Plaid txn ids, "Not a bill"
 *     vendors, detector throttle). One `get` per reader.
 *
 * Resolved items carry `expireAt` (console TTL policy on that field); open and dismissed items
 * never do (a dismissed item is the visible half of the "Not a bill" memory).
 *
 * @module repositories/recurring_review
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recurring_review_repo = exports.DETECTOR_STATE_COLLECTION = exports.REVIEW_STATE_COLLECTION = exports.REVIEW_ITEMS_COLLECTION = void 0;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../types");
const review_item_service_1 = require("../domain/recurring/review_item.service");
const purge_guard_1 = require("../infrastructure/purge_guard");
/** Purge states that stop every background writer (mirrors `is_user_purging`). */
const PURGING_STATES = new Set(["requested", "running", "done"]);
const purge_ref = (user_id) => (0, firestore_1.getFirestore)().collection(purge_guard_1.PURGE_STATUS_COLLECTION).doc(user_id);
exports.REVIEW_ITEMS_COLLECTION = "recurring_review_items";
exports.REVIEW_STATE_COLLECTION = "_recurring_review_state";
/** Reserved (rules deny-all, purged); the detector throttle lives in the review state doc (X8). */
exports.DETECTOR_STATE_COLLECTION = "_recurring_detector_state";
function state_from_doc(user_id, d) {
    var _a, _b, _c, _d, _e;
    return {
        user_id,
        suppressed_txn_ids: (_a = d.suppressedTxnIds) !== null && _a !== void 0 ? _a : [],
        dismissed_vendor_keys: (_b = d.dismissedVendorKeys) !== null && _b !== void 0 ? _b : [],
        detector_last_run_day: (_c = d.detectorLastRunDay) !== null && _c !== void 0 ? _c : null,
        pending_tracks: ((_d = d.pendingTracks) !== null && _d !== void 0 ? _d : []).map((p) => {
            var _a, _b, _c, _d, _e;
            return (Object.assign({ item_id: p.itemId, plaid_item_doc_id: (_a = p.plaidItemDocId) !== null && _a !== void 0 ? _a : null, account_id: (_b = p.accountId) !== null && _b !== void 0 ? _b : null, stream_id: (_c = p.streamId) !== null && _c !== void 0 ? _c : null, since_ms: (_d = p.sinceMs) !== null && _d !== void 0 ? _d : 0 }, (typeof p.handedOffMs === "number"
                ? { handed_off_ms: p.handedOffMs, awaiting_item_doc_ids: (_e = p.awaitingItemDocIds) !== null && _e !== void 0 ? _e : [] }
                : {})));
        }),
        suggested_owners: ((_e = d.suggestedOwners) !== null && _e !== void 0 ? _e : []).map((o) => ({ item_id: o.itemId, plaid_item_doc_id: o.plaidItemDocId })),
    };
}
function state_to_doc(state) {
    var _a, _b;
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        userId: state.user_id,
        suppressedTxnIds: state.suppressed_txn_ids,
        suppressedHash: (0, review_item_service_1.suppressed_hash)(state),
        dismissedVendorKeys: state.dismissed_vendor_keys,
        detectorLastRunDay: state.detector_last_run_day,
        pendingTracks: ((_a = state.pending_tracks) !== null && _a !== void 0 ? _a : []).map((p) => {
            var _a;
            return (Object.assign({ itemId: p.item_id, plaidItemDocId: p.plaid_item_doc_id, accountId: p.account_id, streamId: p.stream_id, sinceMs: p.since_ms }, (typeof p.handed_off_ms === "number"
                ? { handedOffMs: p.handed_off_ms, awaitingItemDocIds: (_a = p.awaiting_item_doc_ids) !== null && _a !== void 0 ? _a : [] }
                : {})));
        }),
        suggestedOwners: ((_b = state.suggested_owners) !== null && _b !== void 0 ? _b : []).map((o) => ({ itemId: o.item_id, plaidItemDocId: o.plaid_item_doc_id })),
        updatedAt: firestore_1.Timestamp.now(),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
function to_doc(item) {
    return Object.assign({ id: item.id, userId: item.user_id, kind: item.kind, direction: item.direction, source: item.source, status: item.status, answer: item.answer, subjectKey: item.subject_key, vendorKey: item.vendor_key, accountId: item.account_id, plaidItemDocId: item.plaid_item_doc_id, streamId: item.stream_id, recordId: item.record_id, name: item.name, amount: item.amount, frequency: item.frequency, plaidStatus: item.plaid_status, category: item.category, transactionIds: item.transaction_ids, nextDueDate: item.next_due_ms !== null ? firestore_1.Timestamp.fromMillis(item.next_due_ms) : null, userFrequency: item.user_frequency, contentHash: item.content_hash, createdAt: firestore_1.Timestamp.fromMillis(item.created_at_ms), updatedAt: firestore_1.Timestamp.fromMillis(item.updated_at_ms), resolvedAt: item.resolved_at_ms !== null ? firestore_1.Timestamp.fromMillis(item.resolved_at_ms) : null }, (item.status === "resolved" && item.resolved_at_ms !== null
        ? { expireAt: firestore_1.Timestamp.fromMillis(item.resolved_at_ms + review_item_service_1.RESOLVED_ITEM_TTL_MS) }
        : {}));
}
/* eslint-enable @typescript-eslint/naming-convention */
function from_doc(d) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    return {
        id: d.id,
        user_id: d.userId,
        kind: d.kind,
        direction: d.direction,
        source: d.source,
        status: d.status,
        answer: (_a = d.answer) !== null && _a !== void 0 ? _a : null,
        subject_key: d.subjectKey,
        vendor_key: (_b = d.vendorKey) !== null && _b !== void 0 ? _b : null,
        account_id: (_c = d.accountId) !== null && _c !== void 0 ? _c : null,
        plaid_item_doc_id: (_d = d.plaidItemDocId) !== null && _d !== void 0 ? _d : null,
        stream_id: (_e = d.streamId) !== null && _e !== void 0 ? _e : null,
        record_id: (_f = d.recordId) !== null && _f !== void 0 ? _f : null,
        name: d.name,
        amount: d.amount,
        frequency: (_g = d.frequency) !== null && _g !== void 0 ? _g : null,
        plaid_status: (_h = d.plaidStatus) !== null && _h !== void 0 ? _h : null,
        category: (_j = d.category) !== null && _j !== void 0 ? _j : null,
        transaction_ids: (_k = d.transactionIds) !== null && _k !== void 0 ? _k : [],
        next_due_ms: d.nextDueDate ? d.nextDueDate.toMillis() : null,
        user_frequency: (_l = d.userFrequency) !== null && _l !== void 0 ? _l : null,
        content_hash: d.contentHash,
        created_at_ms: (_p = (_o = (_m = d.createdAt) === null || _m === void 0 ? void 0 : _m.toMillis) === null || _o === void 0 ? void 0 : _o.call(_m)) !== null && _p !== void 0 ? _p : 0,
        updated_at_ms: (_s = (_r = (_q = d.updatedAt) === null || _q === void 0 ? void 0 : _q.toMillis) === null || _r === void 0 ? void 0 : _r.call(_q)) !== null && _s !== void 0 ? _s : 0,
        resolved_at_ms: d.resolvedAt ? d.resolvedAt.toMillis() : null,
    };
}
const items = () => (0, firestore_1.getFirestore)().collection(exports.REVIEW_ITEMS_COLLECTION);
const state_ref = (user_id) => (0, firestore_1.getFirestore)().collection(exports.REVIEW_STATE_COLLECTION).doc(user_id);
exports.recurring_review_repo = {
    /** The user's review state, or null (1 read). */
    async get_state(_ctx, user_id) {
        if (!user_id)
            return null;
        const snap = await state_ref(user_id).get();
        return snap.exists ? state_from_doc(user_id, snap.data()) : null;
    },
    /**
     * Apply a change to the user's review state ATOMICALLY: read-modify-write in one transaction, so
     * concurrent writers (a sync, an answer, the detector) never lose each other's change (e.g. a
     * "Not a bill" landing while a sync writes its held-out ids). Writes only when it changed.
     * Callers first check the change against the state they already read and skip this when it is a
     * no-op there (no extra read). Returns the previous (fresh) state and what changed.
     */
    async apply_state_change(ctx, user_id, change) {
        const db = (0, firestore_1.getFirestore)();
        const ref = state_ref(user_id);
        const out = await db.runTransaction(async (tx) => {
            var _a;
            const [snap, purge] = await tx.getAll(ref, purge_ref(user_id));
            const previous = snap.exists ? state_from_doc(user_id, snap.data()) : null;
            const r = (0, review_item_service_1.apply_review_state_change)(previous, user_id, change);
            // Never (re)create the state of a user being erased — checked inside the transaction, so a
            // purge that starts after a writer's plan still wins (Top-25 #15).
            const purging = purge.exists && PURGING_STATES.has(String((_a = purge.data()) === null || _a === void 0 ? void 0 : _a.state));
            if (purging)
                return Object.assign(Object.assign({ previous }, r), { changed: false, suppressed_changed: false });
            if (r.changed)
                tx.set(ref, state_to_doc(r.next));
            return Object.assign({ previous }, r);
        });
        if (out.changed) {
            console.log(`[${ctx.trace_id}] recurring_review_repo.apply_state_change ${user_id}: ` +
                `suppressed=${out.next.suppressed_txn_ids.length} dismissed=${out.next.dismissed_vendor_keys.length}`);
        }
        return out;
    },
    /**
     * Undo a user's answer whose re-sync could not be queued — GUARDED, in one transaction: re-open
     * the item only if it still equals what the answer wrote AND the review state still holds its
     * pending track (a racing sync that already consumed the track, or a newer answer, wins), and
     * never for a user being erased. Removes the pending track in the same write. Returns whether
     * it rolled back, and whether the suppressed set changed (the caller bumps).
     */
    async rollback_answer(_ctx, user_id, args) {
        const db = (0, firestore_1.getFirestore)();
        const ref = items().doc(args.answered.id);
        return db.runTransaction(async (tx) => {
            var _a, _b;
            const [item_snap, state_snap, purge] = await tx.getAll(ref, state_ref(user_id), purge_ref(user_id));
            if (purge.exists && PURGING_STATES.has(String((_a = purge.data()) === null || _a === void 0 ? void 0 : _a.state)))
                return { rolled_back: false };
            if (!item_snap.exists)
                return { rolled_back: false };
            const current = from_doc(item_snap.data());
            const same = current.status === args.answered.status && current.answer === args.answered.answer &&
                current.updated_at_ms === args.answered.updated_at_ms && current.resolved_at_ms === args.answered.resolved_at_ms &&
                current.content_hash === args.answered.content_hash && current.user_frequency === args.answered.user_frequency;
            const state = state_snap.exists ? state_from_doc(user_id, state_snap.data()) : null;
            const holds_track = !!state && ((_b = state.pending_tracks) !== null && _b !== void 0 ? _b : []).some((p) => p.item_id === args.answered.id);
            if (!same || !holds_track)
                return { rolled_back: false };
            const r = (0, review_item_service_1.apply_review_state_change)(state, user_id, { remove_pending_track_ids: [args.answered.id] });
            tx.set(ref, to_doc(args.original));
            if (r.changed)
                tx.set(state_ref(user_id), state_to_doc(r.next));
            return { rolled_back: true };
        });
    },
    /** The items at these (deterministic) ids — one batched read; missing ids are absent (X8). */
    async get_items_by_ids(_ctx, ids) {
        const out = new Map();
        const unique = [...new Set(ids)];
        for (const chunk of (0, types_1.chunk_for_batch)(unique)) {
            if (chunk.length === 0)
                continue;
            const snaps = await (0, firestore_1.getFirestore)().getAll(...chunk.map((id) => items().doc(id)));
            for (const s of snaps)
                if (s.exists)
                    out.set(s.id, from_doc(s.data()));
        }
        return out;
    },
    /** One item (1 read), or null. */
    async get_item(_ctx, id) {
        const snap = await items().doc(id).get();
        return snap.exists ? from_doc(snap.data()) : null;
    },
    /**
     * BACKGROUND writers (sync planner, detector, account removal): write items only where it is
     * still safe, in a transaction against the fresh docs (review round 3 defect 1). `seen` is each
     * item as the writer read it when planning (absent = it did not exist). An item that changed
     * since (a user's answer, a racing writer), was created or deleted since, or carries a user's
     * answer is SKIPPED — never reverted. Nothing is written for a user being erased (purge state
     * read in the same transaction). Costs one read per item written + 1 (only when items changed).
     * Returns the count written and the ids skipped.
     */
    async write_items_guarded(ctx, user_id, list, seen) {
        if (list.length === 0)
            return { written: 0, skipped: [] };
        const db = (0, firestore_1.getFirestore)();
        let written = 0;
        const skipped = [];
        // Transactions hold at most 500 writes; review items per sync are a handful.
        for (const chunk of (0, types_1.chunk_for_batch)(list, 400)) {
            const r = await db.runTransaction(async (tx) => {
                var _a;
                const snaps = await tx.getAll(purge_ref(user_id), ...chunk.map((i) => items().doc(i.id)));
                const [purge, ...item_snaps] = snaps;
                if (purge.exists && PURGING_STATES.has(String((_a = purge.data()) === null || _a === void 0 ? void 0 : _a.state))) {
                    return { written: 0, skipped: chunk.map((i) => i.id) };
                }
                let n = 0;
                const skip = [];
                chunk.forEach((item, k) => {
                    const snap = item_snaps[k];
                    const current = snap.exists ? from_doc(snap.data()) : null;
                    if (item.user_id !== user_id || !(0, review_item_service_1.may_background_write)(current, seen.get(item.id), item)) {
                        skip.push(item.id);
                        return;
                    }
                    tx.set(items().doc(item.id), to_doc(item));
                    n++;
                });
                return { written: n, skipped: skip };
            });
            written += r.written;
            skipped.push(...r.skipped);
        }
        console.log(`[${ctx.trace_id}] recurring_review_repo.write_items_guarded ${user_id}: wrote ${written}, skipped ${skipped.length}`);
        return { written, skipped };
    },
    /** Upsert items (full replace — the domain built the whole item). Batched. Returns count.
     *  Only for the user's OWN answer (the answer callable) and tests — background writers use
     *  `write_items_guarded`. */
    async upsert_items(ctx, list) {
        if (list.length === 0)
            return 0;
        for (const chunk of (0, types_1.chunk_for_batch)(list)) {
            const batch = (0, firestore_1.getFirestore)().batch();
            for (const item of chunk)
                batch.set(items().doc(item.id), to_doc(item));
            await batch.commit();
        }
        console.log(`[${ctx.trace_id}] recurring_review_repo.upsert_items: ${list.length}`);
        return list.length;
    },
    /** The user's OPEN items on one account (account removal closes them, X19). */
    async get_open_for_account(_ctx, user_id, account_id) {
        const snap = await items()
            .where("userId", "==", user_id)
            .where("accountId", "==", account_id)
            .where("status", "==", "open")
            .get();
        return snap.docs.map((d) => from_doc(d.data()));
    },
    /** The user's OPEN items (what the app's one listener sees; used by tests / tooling). */
    async get_open_for_user(_ctx, user_id) {
        const snap = await items().where("userId", "==", user_id).where("status", "==", "open").get();
        return snap.docs.map((d) => from_doc(d.data()));
    },
};
//# sourceMappingURL=recurring_review.repo.js.map