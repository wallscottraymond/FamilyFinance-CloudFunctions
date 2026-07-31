"use strict";
/**
 * Purge Repository
 *
 * Persistence primitives for the full-erase purge: batched HARD deletes by
 * field or by parent-id, id collection, pending-job cancellation, and the
 * defensive group ownership checks. Purge intentionally hard-deletes (not the
 * per-entity soft-delete repos) — it must leave nothing behind.
 *
 * All deletes are batched at the Firestore 500-doc limit and loop until the
 * query is dry, so an arbitrarily large user (1000s of txns) purges without a
 * single oversized batch. Every method is idempotent — a re-run simply finds
 * fewer (or zero) matching docs.
 *
 * @module repositories/purge
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.make_bulk_writer = make_bulk_writer;
exports.collect_ids = collect_ids;
exports.hard_delete_by_field = hard_delete_by_field;
exports.hard_delete_by_parent_ids = hard_delete_by_parent_ids;
exports.cancel_pending_jobs = cancel_pending_jobs;
exports.find_owned_shared_groups = find_owned_shared_groups;
exports.delete_owned_solo_groups = delete_owned_solo_groups;
exports.hard_delete_doc = hard_delete_doc;
const firestore_1 = require("firebase-admin/firestore");
const BATCH_LIMIT = 500;
/** How many doc ids to read per page (keys-only). */
const READ_PAGE = 1000;
/**
 * A BulkWriter parallelizes deletes (auto-batches, ramps throughput, retries)
 * — far faster than sequential 500-doc `batch.commit()`s for a big purge. One
 * writer is shared across all of a run's sweeps; `flush()`/`close()` awaits them.
 */
function make_bulk_writer() {
    return (0, firestore_1.getFirestore)().bulkWriter();
}
/** Collect the doc ids in `collection` where `field == value`. */
async function collect_ids(collection, field, value) {
    const snap = await (0, firestore_1.getFirestore)()
        .collection(collection)
        .where(field, "==", value)
        .select()
        .get();
    return snap.docs.map((d) => d.id);
}
/**
 * Hard-delete every doc in `collection` where `field == value`, enqueuing the
 * deletes onto the shared BulkWriter (which commits them in parallel). Reads the
 * ids keys-only, paginated by document id (stable — deletes are async so we
 * can't re-query the same predicate). Returns the count enqueued. `on_batch`
 * fires per read page for live progress.
 *
 * NOTE: an equality filter + `orderBy(documentId())` is served by the automatic
 * single-field index — no composite index required.
 */
async function hard_delete_by_field(collection, field, value, writer, on_batch) {
    const db = (0, firestore_1.getFirestore)();
    let total = 0;
    let last;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let q = db
            .collection(collection)
            .where(field, "==", value)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(READ_PAGE)
            .select();
        if (last !== undefined) {
            q = q.startAfter(last);
        }
        const snap = await q.get();
        if (snap.empty) {
            break;
        }
        for (const doc of snap.docs) {
            // BulkWriter.delete returns a promise we intentionally don't await here —
            // the writer commits in parallel; `flush()`/`close()` awaits them later.
            void writer.delete(doc.ref);
        }
        total += snap.size;
        last = snap.docs[snap.docs.length - 1].id;
        if (on_batch) {
            await on_batch(snap.size);
        }
        if (snap.size < READ_PAGE) {
            break;
        }
    }
    return total;
}
/**
 * Hard-delete every doc in `collection` whose `parent_field` is one of
 * `parent_ids` (the "subcollection" pattern — these are top-level collections
 * keyed by a parent id). Iterates parent ids; each is its own batched sweep.
 */
async function hard_delete_by_parent_ids(collection, parent_field, parent_ids, writer, on_batch) {
    let total = 0;
    for (const parent_id of parent_ids) {
        total += await hard_delete_by_field(collection, parent_field, parent_id, writer, on_batch);
    }
    return total;
}
/**
 * Cancel the user's PENDING/PROCESSING jobs so nothing runs mid/post-purge.
 * Marks them `cancelled` (terminal) rather than deleting, preserving the audit
 * trail. Matches on `payload.user_id` (the convention across job payloads).
 *
 * TARGETED by default: queries only THIS user's pending/processing jobs via the
 * `_jobs (payload.user_id, status)` composite index — so it scales when many
 * users purge concurrently (no scan of the global queue). Falls back to a full
 * scan only if that query fails (e.g. the index is still building after deploy).
 */
async function cancel_pending_jobs(user_id, exclude_job_id) {
    try {
        return await cancel_pending_jobs_targeted(user_id, exclude_job_id);
    }
    catch (err) {
        // Most likely FAILED_PRECONDITION (composite index not built yet). The scan
        // is the correct (slower) superset behavior — use it so a purge never breaks.
        console.warn(`[purge] targeted job-cancel failed (${err.message}); ` +
            `falling back to full scan`);
        return await cancel_pending_jobs_scan(user_id, exclude_job_id);
    }
}
/** Skip predicate shared by both strategies. */
function should_skip_job(doc, exclude_job_id) {
    if (doc.id === exclude_job_id) {
        return true;
    }
    // Never cancel a purge job (incl. this one) — that would abort the erase.
    return doc.data().job_type === "purge_user_data";
}
/** Mark a page of jobs `cancelled` in ≤500 batches. Returns the count. */
async function cancel_docs(docs, exclude_job_id, now) {
    const db = (0, firestore_1.getFirestore)();
    const to_cancel = docs.filter((d) => !should_skip_job(d, exclude_job_id));
    let cancelled = 0;
    for (let i = 0; i < to_cancel.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const doc of to_cancel.slice(i, i + BATCH_LIMIT)) {
            batch.update(doc.ref, {
                status: "cancelled",
                updated_at: now,
                error_message: "user_purge",
            });
            cancelled++;
        }
        await batch.commit();
    }
    return cancelled;
}
/** Targeted: only this user's pending/processing jobs (composite index). */
async function cancel_pending_jobs_targeted(user_id, exclude_job_id) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    let cancelled = 0;
    let last;
    // Cursor pagination (by document id): skipped docs — the purge job itself —
    // stay pending, so a re-query of the same predicate would loop forever; the
    // cursor advances past them instead.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let q = db
            .collection("_jobs")
            .where("payload.user_id", "==", user_id)
            .where("status", "in", ["pending", "processing"])
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(READ_PAGE);
        if (last) {
            q = q.startAfter(last.id);
        }
        const snap = await q.get();
        if (snap.empty) {
            break;
        }
        cancelled += await cancel_docs(snap.docs, exclude_job_id, now);
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < READ_PAGE) {
            break;
        }
    }
    return cancelled;
}
/** Fallback: scan all pending/processing jobs, filter by user in memory. */
async function cancel_pending_jobs_scan(user_id, exclude_job_id) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    const snap = await db
        .collection("_jobs")
        .where("status", "in", ["pending", "processing"])
        .get();
    const matching = snap.docs.filter((d) => {
        var _a;
        const payload = ((_a = d.data().payload) !== null && _a !== void 0 ? _a : {});
        return payload.user_id === user_id;
    });
    return cancel_docs(matching, exclude_job_id, now);
}
/**
 * Groups the user OWNS that still have other members — a purge must not orphan
 * these; the caller blocks until ownership is transferred. Defensive against
 * the in-flight sharing schema (`groups` uses `ownerId`+`members[]`; the legacy
 * `families` uses `adminUserId`+`memberIds[]`) — checks both, never throws.
 */
async function find_owned_shared_groups(user_id) {
    var _a, _b, _c, _d, _e, _f;
    const db = (0, firestore_1.getFirestore)();
    const out = [];
    try {
        const groups = await db
            .collection("groups")
            .where("ownerId", "==", user_id)
            .get();
        for (const d of groups.docs) {
            const data = d.data();
            if (data.isActive !== false && ((_b = (_a = data.members) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 1) {
                out.push({ id: d.id, name: (_c = data.name) !== null && _c !== void 0 ? _c : "Untitled group" });
            }
        }
    }
    catch (_g) {
        // groups collection absent / schema drift — ignore (nothing to block on).
    }
    try {
        const families = await db
            .collection("families")
            .where("adminUserId", "==", user_id)
            .get();
        for (const d of families.docs) {
            const data = d.data();
            if (((_e = (_d = data.memberIds) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0) > 1) {
                out.push({ id: d.id, name: (_f = data.name) !== null && _f !== void 0 ? _f : "Untitled family" });
            }
        }
    }
    catch (_h) {
        // families collection absent — ignore.
    }
    return out;
}
/**
 * Hard-delete the SOLE-member groups/families the user owns (nothing to
 * transfer). Owned groups with other members are handled by the pre-check
 * block, so by purge time only solo groups remain. Best-effort / never throws.
 *
 * NOTE: cleanup of the user's membership in groups OWNED BY OTHERS is deferred
 * — it depends on the in-flight embedded-membership model (see project doc).
 */
async function delete_owned_solo_groups(user_id) {
    var _a;
    const db = (0, firestore_1.getFirestore)();
    let deleted = 0;
    for (const [collection, ownerField, membersField] of [
        ["groups", "ownerId", "members"],
        ["families", "adminUserId", "memberIds"],
    ]) {
        try {
            const snap = await db
                .collection(collection)
                .where(ownerField, "==", user_id)
                .get();
            const batch = db.batch();
            let n = 0;
            for (const d of snap.docs) {
                const members = (_a = d.data()[membersField]) !== null && _a !== void 0 ? _a : [];
                if (members.length <= 1) {
                    batch.delete(d.ref);
                    n++;
                }
            }
            if (n > 0) {
                await batch.commit();
                deleted += n;
            }
        }
        catch (_b) {
            // collection absent / schema drift — ignore.
        }
    }
    return deleted;
}
/** Hard-delete a single doc by id (used for `users/{uid}`). Idempotent. */
async function hard_delete_doc(collection, doc_id) {
    await (0, firestore_1.getFirestore)().collection(collection).doc(doc_id).delete();
}
//# sourceMappingURL=purge.repo.js.map