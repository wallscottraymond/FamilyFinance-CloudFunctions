"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_legacy_split_categories = backfill_legacy_split_categories;
exports.legacy_txn_fields_to_clear = legacy_txn_fields_to_clear;
const split_category_edit_service_1 = require("./split_category_edit.service");
/* eslint-disable @typescript-eslint/naming-convention */
function backfill_legacy_split_categories(splits, catalog) {
    let changed = false;
    let picks_carried = 0;
    const out = splits.map((s) => {
        var _a;
        const first = (0, split_category_edit_service_1.legacy_override_first)(s, catalog);
        const has_legacy = s.internalDetailedCategory != null || s.internalPrimaryCategory != null;
        if (!first && !has_legacy)
            return s;
        changed = true;
        const next = Object.assign(Object.assign({}, s), { internalDetailedCategory: null, internalPrimaryCategory: null });
        if (first) {
            picks_carried++;
            next.categorySource = "user";
            next.firstCategoryId = first;
            next.overallCategoryId = (_a = catalog.overall_by_first[first]) !== null && _a !== void 0 ? _a : null;
            next.secondCategoryId = null;
        }
        return next;
    });
    return { splits: changed ? out : splits, changed, picks_carried };
}
/* eslint-enable @typescript-eslint/naming-convention */
/** The transaction-level legacy fields, cleared (empty when there's nothing to clear). */
function legacy_txn_fields_to_clear(data) {
    if (data.internalDetailedCategory == null && data.internalPrimaryCategory == null)
        return {};
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    return { internalDetailedCategory: null, internalPrimaryCategory: null };
}
//# sourceMappingURL=legacy_category_backfill.service.js.map