"use strict";
/**
 * Feedback Repository (Feedback-And-Questions)
 *
 * - `feedback/{noteId}`: one note. Has NO sender field (D2/D7) — never add one.
 * - `feedback_senders/{uid}`: the sender's own note ids (newest first, bounded) + daily counter.
 *
 * Functions-only: the rules deny every client read and write on both.
 *
 * @module repositories/feedback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedback_repo = exports.FEEDBACK_SENDERS_COLLECTION = exports.FEEDBACK_COLLECTION = void 0;
const firestore_1 = require("firebase-admin/firestore");
const feedback_types_1 = require("../types/feedback.types");
exports.FEEDBACK_COLLECTION = "feedback";
exports.FEEDBACK_SENDERS_COLLECTION = "feedback_senders";
/** `getAll` / `in` batch size. */
const READ_CHUNK = 100;
const notes = () => (0, firestore_1.getFirestore)().collection(exports.FEEDBACK_COLLECTION);
const senders = () => (0, firestore_1.getFirestore)().collection(exports.FEEDBACK_SENDERS_COLLECTION);
/* eslint-disable @typescript-eslint/naming-convention */
function note_to_doc(note) {
    return {
        type: note.type,
        message: note.message,
        appVersion: note.app_version,
        build: note.build,
        screen: note.screen,
        device: note.device,
        osVersion: note.os_version,
        createdAt: firestore_1.Timestamp.fromMillis(note.created_at_ms),
        status: note.status,
        readByOwner: note.read_by_owner,
        reply: note.reply
            ? { message: note.reply.message, repliedAt: firestore_1.Timestamp.fromMillis(note.reply.replied_at_ms) }
            : null,
    };
}
function sender_to_doc(sender) {
    return {
        noteIds: sender.note_ids,
        dailyCount: sender.daily_count,
        dailyDate: sender.daily_date,
        retiredNoteIds: sender.retired_note_ids,
    };
}
/* eslint-enable @typescript-eslint/naming-convention */
const str = (v) => (typeof v === "string" && v ? v : null);
const ms = (v) => (v instanceof firestore_1.Timestamp ? v.toMillis() : 0);
function doc_to_note(id, d) {
    var _a, _b;
    const known = feedback_types_1.FEEDBACK_TYPES.includes(d.type);
    const type = known ? d.type : "other";
    const reply = d.reply && typeof d.reply.message === "string"
        ? { message: d.reply.message, replied_at_ms: ms(d.reply.repliedAt) }
        : null;
    return {
        id,
        type,
        message: typeof d.message === "string" ? d.message : "",
        app_version: (_a = str(d.appVersion)) !== null && _a !== void 0 ? _a : "",
        build: (_b = str(d.build)) !== null && _b !== void 0 ? _b : "",
        screen: str(d.screen),
        device: str(d.device),
        os_version: str(d.osVersion),
        created_at_ms: ms(d.createdAt),
        status: d.status === "done" ? "done" : "open",
        read_by_owner: d.readByOwner === true,
        reply,
    };
}
function doc_to_sender(d) {
    if (!d)
        return null;
    return {
        note_ids: Array.isArray(d.noteIds)
            ? d.noteIds.filter((x) => typeof x === "string")
            : [],
        daily_count: typeof d.dailyCount === "number" ? d.dailyCount : 0,
        daily_date: typeof d.dailyDate === "string" ? d.dailyDate : "",
        retired_note_ids: Array.isArray(d.retiredNoteIds)
            ? d.retiredNoteIds.filter((x) => typeof x === "string")
            : [],
    };
}
exports.feedback_repo = {
    /**
     * The send, atomically: read the sender record + whether the note id exists, let the (pure)
     * plan decide, then write the note and the sender record together — or nothing. `create` (not
     * `set`) on the note is a second guard: an id that appeared since the read fails the commit and
     * the transaction retries against the fresh snapshot.
     */
    async submit_in_transaction(_ctx, user_id, note_id, plan) {
        if (!user_id || !note_id)
            throw new Error("submit_in_transaction requires user_id and note_id");
        const db = (0, firestore_1.getFirestore)();
        const sender_ref = senders().doc(user_id);
        const note_ref = notes().doc(note_id);
        return db.runTransaction(async (tx) => {
            const [sender_snap, note_snap] = await tx.getAll(sender_ref, note_ref);
            const planned = plan(doc_to_sender(sender_snap.data()), note_snap.exists);
            if (planned.write) {
                tx.create(note_ref, note_to_doc(planned.write.note));
                tx.set(sender_ref, sender_to_doc(planned.write.sender));
            }
            return planned.result;
        });
    },
    async get_sender(_ctx, user_id) {
        const snap = await senders().doc(user_id).get();
        return doc_to_sender(snap.data());
    },
    /** Notes by id (missing ids are skipped). */
    async get_notes(_ctx, note_ids) {
        const out = [];
        for (let i = 0; i < note_ids.length; i += READ_CHUNK) {
            const refs = note_ids.slice(i, i + READ_CHUNK).map((id) => notes().doc(id));
            if (refs.length === 0)
                continue;
            const snaps = await (0, firestore_1.getFirestore)().getAll(...refs);
            for (const s of snaps)
                if (s.exists)
                    out.push(doc_to_note(s.id, s.data()));
        }
        return out;
    },
    async get_note(_ctx, note_id) {
        const snap = await notes().doc(note_id).get();
        return snap.exists ? doc_to_note(snap.id, snap.data()) : null;
    },
    /**
     * Inbox page: notes with this status (and type, when given), newest first. Reads `limit + 1` so
     * the caller knows whether more exist. Indexes: (status, createdAt desc) and
     * (status, type, createdAt desc).
     */
    async list_inbox(_ctx, status, type, limit) {
        let q = notes().where("status", "==", status);
        if (type)
            q = q.where("type", "==", type);
        const snap = await q
            .orderBy("createdAt", "desc")
            .orderBy(firestore_1.FieldPath.documentId(), "desc")
            .limit(limit + 1)
            .get();
        const all = snap.docs.map((d) => doc_to_note(d.id, d.data()));
        return { notes: all.slice(0, limit), truncated: all.length > limit };
    },
    /** Notes the owner hasn't opened (aggregation: one read per 1,000 notes). */
    async count_unread(_ctx) {
        const agg = await notes().where("readByOwner", "==", false).count().get();
        return agg.data().count;
    },
    /**
     * Set inbox fields on a note. Returns false when the note doesn't exist (nothing written) or
     * already has these values (nothing written — no needless write).
     */
    async update_note_fields(_ctx, note_id, fields) {
        const ref = notes().doc(note_id);
        return (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                return false;
            const d = snap.data();
            /* eslint-disable @typescript-eslint/naming-convention */
            const patch = {};
            if (fields.status !== undefined && d.status !== fields.status)
                patch.status = fields.status;
            if (fields.read_by_owner !== undefined && (d.readByOwner === true) !== fields.read_by_owner) {
                patch.readByOwner = fields.read_by_owner;
            }
            /* eslint-enable @typescript-eslint/naming-convention */
            if (Object.keys(patch).length === 0)
                return false;
            tx.update(ref, patch);
            return true;
        });
    },
    /**
     * Delete a note and take its id off whichever sender list holds it (found by array-contains —
     * the note itself never says who sent it). `next` computes the sender's new record (list +
     * retired ids). Returns false when the note was already gone.
     */
    async delete_note(_ctx, note_id, next) {
        const db = (0, firestore_1.getFirestore)();
        const ref = notes().doc(note_id);
        return db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const holders = await tx.get(senders().where("noteIds", "array-contains", note_id).limit(10));
            if (!snap.exists && holders.empty)
                return false;
            for (const h of holders.docs) {
                const sender = doc_to_sender(h.data());
                tx.set(h.ref, sender_to_doc(next(sender)));
            }
            if (snap.exists)
                tx.delete(ref);
            return snap.exists;
        });
    },
};
//# sourceMappingURL=feedback.repo.js.map