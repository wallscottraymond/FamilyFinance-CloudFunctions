/**
 * Split Category Edit — what a split edit writes to a split's category fields (canon M1, M2, M3).
 *
 * The split editor sends the whole splits array. For each split this decides the category
 * fields to store, from (in order):
 *   1. the app's explicit pick — `categorySource: "user"` + a known `firstCategoryId`
 *      (or `secondCategoryId` = a Plaid code), validated against the collection;
 *      `categorySource: "plaid"` on a split that was a user pick = "use auto" (reset);
 *   2. a bare `categoryId` from older app builds (a first slug or a Plaid code), translated to
 *      the same pick — only when it CHANGED and lands on a different first than the split has,
 *      so re-saving an untouched split never turns it into a pick (Plaid keeps updating it, M4);
 *   3. otherwise the split's stored category, unchanged.
 * The Plaid codes are immutable (M1): an existing split keeps its own; a new split inherits the
 * transaction's. The legacy `internal*` fields are always written null (M2).
 *
 * PURE: no IO.
 *
 * @module domain/transactions/split_category_edit
 */
import { CategoryCatalog, SplitCategoryInput } from "./split_category.service";
export interface SplitCategoryFields {
    plaidPrimaryCategory: string | null;
    plaidDetailedCategory: string | null;
    categorySource: "plaid" | "user";
    firstCategoryId: string | null;
    overallCategoryId: string | null;
    secondCategoryId: string | null;
    internalPrimaryCategory: null;
    internalDetailedCategory: null;
}
type Raw = Record<string, unknown>;
/**
 * A split's LEGACY override (`internalDetailedCategory`, else `internalPrimaryCategory` — a Plaid
 * code or a slug from older writers) as the first slug it means, when it differs from what Plaid
 * gives the split. Null when there's none, it's unknown, or it agrees with Plaid. Shared with the
 * one-time backfill so an edit before the backfill keeps the user's old pick.
 */
export declare function legacy_override_first(split: Raw, catalog: CategoryCatalog): string | null;
/**
 * @param incoming - The split as the app sent it
 * @param existing - The stored split with the same id (undefined = a new split)
 * @param txn - The stored transaction (its first split's Plaid codes seed a new split)
 */
export declare function resolve_split_category_edit(incoming: Raw, existing: Raw | undefined, txn: Raw, catalog: CategoryCatalog): SplitCategoryFields;
/**
 * THE raw-split → category-function input mapper (one for every reader: engine, derive, spend,
 * transfer pairing, audit). Reads the canonical fields; an old reclassify that lives only in the
 * legacy `internal*` fields is read as the user's pick (`legacy_override_first`), so the engine
 * and the period page agree even before the one-time backfill rewrites the doc.
 */
export declare function split_category_input_from_raw(split: Raw, txn: Raw, catalog: CategoryCatalog): SplitCategoryInput;
export {};
//# sourceMappingURL=split_category_edit.service.d.ts.map