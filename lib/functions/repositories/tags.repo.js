"use strict";
/**
 * Tags Repository — the user's tag catalog (`tags` collection).
 *
 * Top-level fields are camelCase (`userId`); one small doc per tag. The catalog loads once
 * (single-field `userId` query, no composite index) and is sorted in memory.
 *
 * @module repositories/tags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tags_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "tags";
const col = () => (0, firestore_1.getFirestore)().collection(COLLECTION);
exports.tags_repo = {
    /** All of a user's tags, name-sorted. */
    async list_tags(_ctx, user_id) {
        const snap = await col().where("userId", "==", user_id).get();
        return snap.docs
            .map((d) => map_to_domain(d.id, d.data()))
            .sort((a, b) => a.name.localeCompare(b.name));
    },
    /** Count a user's tags (for the cap). */
    async count_tags(_ctx, user_id) {
        const agg = await col().where("userId", "==", user_id).count().get();
        return agg.data().count;
    },
    /** Create a tag; returns the new id. */
    async create_tag(_ctx, user_id, fields) {
        const now = firestore_1.Timestamp.now();
        /* eslint-disable @typescript-eslint/naming-convention */
        const ref = await col().add({
            userId: user_id,
            name: fields.name,
            color: fields.color,
            createdAt: now,
            updatedAt: now,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        return ref.id;
    },
    /** Load one tag (ownership checked by the caller). */
    async get_tag(_ctx, tag_id) {
        const doc = await col().doc(tag_id).get();
        return doc.exists
            ? map_to_domain(doc.id, doc.data())
            : null;
    },
    /** Patch a tag's editable fields (name/color). */
    async update_tag(_ctx, tag_id, patch) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const update = { updatedAt: firestore_1.Timestamp.now() };
        if (patch.name !== undefined)
            update.name = patch.name;
        if (patch.color !== undefined)
            update.color = patch.color;
        /* eslint-enable @typescript-eslint/naming-convention */
        await col().doc(tag_id).update(update);
    },
    /** Delete the catalog doc. (Stripping the id off tagged docs/rules is added in later phases,
     *  once `tagIds`/budget tags/rule-tag refs exist to strip.) */
    async delete_tag(_ctx, tag_id) {
        await col().doc(tag_id).delete();
    },
};
/** Map a Firestore tag doc to the domain `Tag`. */
function map_to_domain(id, data) {
    var _a, _b, _c;
    /* eslint-disable @typescript-eslint/naming-convention */
    const d = data;
    /* eslint-enable @typescript-eslint/naming-convention */
    return {
        id,
        user_id: (_a = d.userId) !== null && _a !== void 0 ? _a : "",
        name: (_b = d.name) !== null && _b !== void 0 ? _b : "",
        color: (_c = d.color) !== null && _c !== void 0 ? _c : "#8E8E93",
    };
}
//# sourceMappingURL=tags.repo.js.map