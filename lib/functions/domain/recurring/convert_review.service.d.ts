/**
 * Convert × the "Bills to review" items (Convert-To-Recurring Phase 2) — PURE.
 *
 * Converting a vendor answers its open `suggested` question with the distinct answer `converted`
 * (never `track`): a `converted` close fulfils and creates NOTHING — a Plaid stream of the vendor
 * on another account must not make a second bill (review item 10). The vendor's held-out
 * payments are released and a "Not a bill" memory of it is forgotten (the user now says it IS one).
 *
 * `review_item_id` from the client is never trusted: it must be this user's own id, an open
 * `suggested` item of the same direction and vendor.
 *
 * @module domain/recurring/convert_review
 */
import { ReviewDirection, ReviewItem, ReviewStateChange } from "./review_item.service";
export declare const REVIEW_ITEM_ID_PATTERN: RegExp;
/** The deterministic id of the vendor's `suggested` item. */
export declare function suggested_item_id(user_id: string, direction: ReviewDirection, vendor_key: string): string;
/** An explicit `review_item_id` must be the caller's own (checked before anything is read). PURE. */
export declare function is_own_review_item_id(user_id: string, id: string): boolean;
export interface ConvertReviewPlan {
    ok: true;
    /** Items to write (closed `converted`). */
    items: ReviewItem[];
    state_change: ReviewStateChange;
}
export type ConvertReviewResult = ConvertReviewPlan | {
    ok: false;
    error: string;
};
/**
 * What closing the vendor's question means. `explicit` is the item the app named (if any),
 * `by_vendor` the vendor's own `suggested` item (looked up by its deterministic id); either may be
 * absent. Only OPEN `suggested` items of the same direction + vendor are closed. PURE.
 */
export declare function plan_convert_review(user_id: string, direction: ReviewDirection, vendor_key: string, explicit: ReviewItem | null, by_vendor: ReviewItem | null, explicit_id_given: boolean, now_ms: number): ConvertReviewResult;
//# sourceMappingURL=convert_review.service.d.ts.map