"use strict";
/**
 * Widget Token Repository ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * One read-only widget token per ACCOUNT (both phones of a shared account use it). Two
 * server-only collections (rules deny-all catch-all):
 *   - `_widget_tokens/{uid}`         → { encrypted_token, token_hash, created_at, rotated_at }
 *     The token is stored ENCRYPTED (TOKEN_ENCRYPTION_KEY, same as Plaid tokens) — not only
 *     hashed — so any signed-in device of the account can fetch the same token.
 *   - `_widget_token_index/{sha256}` → { user_id }   (the widget endpoint's lookup; no decrypt)
 *
 * Writes go in one batch so the token and its index never disagree.
 *
 * @module repositories/widget_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.widget_token_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const TOKENS = "_widget_tokens";
const INDEX = "_widget_token_index";
exports.widget_token_repo = {
    /** The account's stored token (encrypted), or null. 1 read. */
    async get_for_user(user_id) {
        var _a;
        const snap = await (0, firestore_1.getFirestore)().collection(TOKENS).doc(user_id).get();
        if (!snap.exists)
            return null;
        const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
        if (typeof data.encrypted_token !== "string" || typeof data.token_hash !== "string") {
            return null;
        }
        return { encrypted_token: data.encrypted_token, token_hash: data.token_hash };
    },
    /** The user owning a token hash, or null (revoked/unknown). 1 read. */
    async get_user_by_hash(token_hash) {
        var _a;
        const snap = await (0, firestore_1.getFirestore)().collection(INDEX).doc(token_hash).get();
        const user_id = snap.exists ? (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.user_id : null;
        return typeof user_id === "string" ? user_id : null;
    },
    /** Store (or rotate to) a new token; removes the previous index entry atomically. */
    async save(user_id, token, previous_hash) {
        const db = (0, firestore_1.getFirestore)();
        const now = firestore_1.Timestamp.now();
        const batch = db.batch();
        batch.set(db.collection(TOKENS).doc(user_id), Object.assign(Object.assign({}, token), { rotated_at: now, created_at: now }));
        batch.set(db.collection(INDEX).doc(token.token_hash), { user_id, created_at: now });
        if (previous_hash && previous_hash !== token.token_hash) {
            batch.delete(db.collection(INDEX).doc(previous_hash));
        }
        await batch.commit();
    },
    /** Revoke the account's token (purge). Idempotent. */
    async delete_for_user(user_id) {
        const db = (0, firestore_1.getFirestore)();
        const existing = await this.get_for_user(user_id);
        const batch = db.batch();
        batch.delete(db.collection(TOKENS).doc(user_id));
        if (existing)
            batch.delete(db.collection(INDEX).doc(existing.token_hash));
        await batch.commit();
    },
};
//# sourceMappingURL=widget_token.repo.js.map