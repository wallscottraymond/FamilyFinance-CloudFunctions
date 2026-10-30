/**
 * Legacy Category Backfill (Transaction-Integrity-Review 3-0b) — PURE.
 *
 * Before the ONE category function (canon M7), a reclassify lived only in the vestigial
 * `internalDetailedCategory` / `internalPrimaryCategory` fields. Nothing reads them any more, so
 * a real old override is carried into the canonical fields once: `categorySource: "user"` +
 * `firstCategoryId` (+ overall from the collection, `secondCategoryId: null`). Every `internal*`
 * value is then cleared. An override that agrees with Plaid's category is just a copy — it's
 * cleared and the split stays Plaid's.
 *
 * Run by the bounded re-assign engine (reassign_user) in memory, before the engine assigns, so
 * the transaction is written once.
 *
 * @module domain/transactions/legacy_category_backfill
 */
import { CategoryCatalog } from "./split_category.service";
type Raw = Record<string, unknown>;
export interface LegacyBackfillResult {
    splits: Raw[];
    /** Any split changed (a pick carried over or a legacy value cleared). */
    changed: boolean;
    /** Splits whose old override became a user pick. */
    picks_carried: number;
}
export declare function backfill_legacy_split_categories(splits: Raw[], catalog: CategoryCatalog): LegacyBackfillResult;
/** The transaction-level legacy fields, cleared (empty when there's nothing to clear). */
export declare function legacy_txn_fields_to_clear(data: Raw): Raw;
export {};
//# sourceMappingURL=legacy_category_backfill.service.d.ts.map