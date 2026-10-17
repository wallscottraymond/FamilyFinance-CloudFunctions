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

import {
  ReviewDirection,
  ReviewItem,
  ReviewStateChange,
  build_review_item_id,
  owner_of_review_item_id,
  resolve_review_item,
  suggested_subject,
} from "./review_item.service";

export const REVIEW_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The deterministic id of the vendor's `suggested` item. */
export function suggested_item_id(user_id: string, direction: ReviewDirection, vendor_key: string): string {
  return build_review_item_id(user_id, "suggested", suggested_subject(direction, vendor_key));
}

/** An explicit `review_item_id` must be the caller's own (checked before anything is read). PURE. */
export function is_own_review_item_id(user_id: string, id: string): boolean {
  return REVIEW_ITEM_ID_PATTERN.test(id) && owner_of_review_item_id(id) === user_id;
}

export interface ConvertReviewPlan {
  ok: true;
  /** Items to write (closed `converted`). */
  items: ReviewItem[];
  state_change: ReviewStateChange;
}
export type ConvertReviewResult = ConvertReviewPlan | { ok: false; error: string };

/**
 * What closing the vendor's question means. `explicit` is the item the app named (if any),
 * `by_vendor` the vendor's own `suggested` item (looked up by its deterministic id); either may be
 * absent. Only OPEN `suggested` items of the same direction + vendor are closed. PURE.
 */
export function plan_convert_review(
  user_id: string,
  direction: ReviewDirection,
  vendor_key: string,
  explicit: ReviewItem | null,
  by_vendor: ReviewItem | null,
  explicit_id_given: boolean,
  now_ms: number
): ConvertReviewResult {
  if (explicit_id_given) {
    if (!explicit || explicit.user_id !== user_id || explicit.kind !== "suggested" ||
        explicit.direction !== direction || explicit.vendor_key !== vendor_key) {
      return { ok: false, error: "That suggestion doesn't match this transaction" };
    }
  }
  const items = new Map<string, ReviewItem>();
  for (const it of [explicit, by_vendor]) if (it && it.status === "open" && it.kind === "suggested") items.set(it.id, it);
  const closed = [...items.values()].map((it) => resolve_review_item(it, "converted", now_ms));
  const released = closed.flatMap((it) => it.transaction_ids);
  return {
    ok: true,
    items: closed,
    state_change: {
      ...(released.length ? { remove_suppressed: released } : {}),
      remove_dismissed_vendor_keys: [suggested_subject(direction, vendor_key)],
    },
  };
}
