/**
 * set_transaction_tags — onCall entry to apply tags to a transaction (owner only).
 *
 * All tags live at the split level. `split_id` null ⇒ set every split's tags (whole-transaction
 * case, common for single-split txns); a value ⇒ set that one split (multi-split advanced). The
 * repository recomputes the top-level `tagIds` union used by array-contains filtering + strip.
 *
 * The FE cannot write `transactions` directly (owner-read rules), so this is the write path.
 *
 * @module entry/callable/set_transaction_tags
 */
export declare const set_transaction_tags: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: true;
}>, unknown>;
//# sourceMappingURL=set_transaction_tags.entry.d.ts.map