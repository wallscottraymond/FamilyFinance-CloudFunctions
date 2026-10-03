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
export interface StoredWidgetToken {
    encrypted_token: string;
    token_hash: string;
}
export declare const widget_token_repo: {
    /** The account's stored token (encrypted), or null. 1 read. */
    get_for_user(user_id: string): Promise<StoredWidgetToken | null>;
    /** The user owning a token hash, or null (revoked/unknown). 1 read. */
    get_user_by_hash(token_hash: string): Promise<string | null>;
    /** Store (or rotate to) a new token; removes the previous index entry atomically. */
    save(user_id: string, token: StoredWidgetToken, previous_hash: string | null): Promise<void>;
    /** Revoke the account's token (purge). Idempotent. */
    delete_for_user(user_id: string): Promise<void>;
};
//# sourceMappingURL=widget_token.repo.d.ts.map