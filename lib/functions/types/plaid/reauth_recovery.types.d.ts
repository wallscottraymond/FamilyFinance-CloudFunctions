/**
 * Re-authentication Recovery Types
 *
 * Types for confirming that a Plaid item needing re-authentication works again
 * (after the user finishes update-mode Link, or after repairing it elsewhere),
 * then marking it healthy and refreshing its data.
 *
 * @module types/plaid/reauth_recovery
 */
/**
 * Statuses that mean "the user must re-authenticate". Probed by the scheduled
 * self-heal pass and by `complete_relink`.
 */
export declare const REAUTH_STATUSES: string[];
/**
 * Plaid sends PENDING_EXPIRATION 7 days before consent expires. A consent that
 * now expires further out than this has been renewed.
 */
export declare const CONSENT_RENEWED_AFTER_MS: number;
/**
 * Most items the scheduled self-heal pass probes per run.
 */
export declare const MAX_REAUTH_PROBES_PER_RUN = 50;
/**
 * An item needing re-authentication, with what the probe needs.
 */
export interface ReauthItem {
    /** Firestore document ID */
    item_doc_id: string;
    /** Plaid's item ID */
    plaid_item_id: string;
    /** Owning user */
    user_id: string;
    /** Current status */
    status: string;
    /** Whether the item is active */
    is_active: boolean;
    /** Decrypted access token, or null if it could not be decrypted */
    access_token: string | null;
}
/**
 * What a probe of Plaid observed for one item.
 */
export interface ReauthProbeResult {
    /** `/accounts/get` succeeded (credentials work) */
    accounts_ok: boolean;
    /** Consent expiration from `/item/get` (ms), null if none or not fetched */
    consent_expiration_ms: number | null;
    /** Whether `/item/get` was called */
    consent_checked: boolean;
}
/**
 * Input for the complete_relink callable.
 */
export interface CompleteRelinkInput {
    /** The Plaid item document ID */
    item_id: string;
}
/**
 * Result of complete_relink.
 */
export interface CompleteRelinkResponse {
    /** Whether the connection is confirmed working */
    repaired: boolean;
    /** The item's status after the call */
    status: string;
    /** Whether a data refresh ran */
    refreshed: boolean;
}
/**
 * Result of one scheduled self-heal pass.
 */
export interface ReauthSelfHealResult {
    probed: number;
    repaired: number;
    still_needs_reauth: number;
}
//# sourceMappingURL=reauth_recovery.types.d.ts.map