/**
 * Merge a Plaid "modified" update into the transaction we already have
 * (Plaid-Modified-Sync-Preserves-Edits).
 *
 * The sync used to write the freshly-built document over the existing one, replacing the
 * whole `splits` array and resetting tags, review flags, categories and the description, so
 * every user edit on that transaction was lost (23,964 rewrites over 6,643 transactions,
 * Aug 15 → Oct 4 2026). This refreshes only what PLAID owns and keeps everything the user (or
 * the app) owns.
 *
 * PURE: no IO. Works on Firestore document shapes (camelCase), since the repository already
 * holds the full existing doc from its batched existence lookup (no extra reads).
 *
 * Ownership (decided 2026-10-05):
 * - Plaid-owned, refreshed: amount, date, names, merchant, vendorKey, Plaid categories, pending
 *   status/ids, account, currency, `isActive`/`isDeleted`; per split: Plaid categories,
 *   source-period ids, paymentDate.
 * - User/app-owned, kept: the splits themselves (ids, count, amounts, descriptions,
 *   Ignore/Refund/Tax, budget + bill pins, tags, rules), `tagIds`, `needsReview`/`needsNote`,
 *   a renamed `description`, the user's category override, `type` (the transfer classifier owns
 *   it), sharing fields, ownership, `initialPlaidData`, `createdAt`.
 * - Amount change: the DEFAULT split absorbs the difference (user decision). If there's no
 *   default split, or it would go negative, splits are rescaled proportionally instead.
 * - Category: a split the user re-categorized (`categorySource: "user"`) keeps its internal
 *   categories; an untouched split takes Plaid's new mapping.
 */
type Doc = Record<string, unknown>;
type Split = Record<string, unknown>;
/** Top-level fields Plaid owns: always taken from the fresh document. */
export declare const PLAID_OWNED_TXN_FIELDS: readonly ["transactionDate", "amount", "currency", "name", "merchantName", "vendorKey", "plaidPrimaryCategory", "plaidDetailedCategory", "plaidItemId", "accountId", "isPending", "pendingTransactionId", "transactionStatus", "isActive", "isDeleted", "updatedAt", "updatedBy"];
/** Per-split fields Plaid (or the date) owns: refreshed on every split. */
export declare const PLAID_OWNED_SPLIT_FIELDS: readonly ["plaidPrimaryCategory", "plaidDetailedCategory", "monthlyPeriodId", "weeklyPeriodId", "biWeeklyPeriodId", "paymentDate"];
/** Re-fit split amounts to a new total (see the header for the rule). */
export declare function refit_split_amounts(splits: Split[], new_total: number): Split[];
/** Returns the document to write for a Plaid "modified" update of an existing transaction. */
export declare function merge_modified_into_existing(existing: Doc, fresh: Doc): Doc;
export {};
//# sourceMappingURL=merge_modified_into_existing.service.d.ts.map