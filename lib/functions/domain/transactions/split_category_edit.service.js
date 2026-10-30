"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacy_override_first = legacy_override_first;
exports.resolve_split_category_edit = resolve_split_category_edit;
exports.split_category_input_from_raw = split_category_input_from_raw;
const split_category_service_1 = require("./split_category.service");
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
/** A first slug or Plaid code → the first slug it means (null when unknown). */
function first_of(id, catalog) {
    var _a, _b;
    if (!id)
        return null;
    if (id in catalog.plaid_by_first)
        return id;
    return (_b = (_a = catalog.slugs_by_plaid[id]) === null || _a === void 0 ? void 0 : _a.first_category_id) !== null && _b !== void 0 ? _b : null;
}
/** As `first_of`, also reading a legacy display name (old rule writes stored "Shopping"). */
function legacy_first_of(id, catalog) {
    var _a, _b;
    if (!id)
        return null;
    return (_b = (_a = first_of(id, catalog)) !== null && _a !== void 0 ? _a : catalog.first_by_name[id.trim().toLowerCase()]) !== null && _b !== void 0 ? _b : null;
}
/**
 * A split's LEGACY override (`internalDetailedCategory`, else `internalPrimaryCategory` — a Plaid
 * code or a slug from older writers) as the first slug it means, when it differs from what Plaid
 * gives the split. Null when there's none, it's unknown, or it agrees with Plaid. Shared with the
 * one-time backfill so an edit before the backfill keeps the user's old pick.
 */
function legacy_override_first(split, catalog) {
    var _a;
    // A real pick in the canonical fields wins; a "user" source with no usable slug (an old
    // reclassify that only wrote internal*) is read from the legacy field.
    if (split.categorySource === "user" &&
        (first_of(str(split.firstCategoryId), catalog) ||
            (str(split.secondCategoryId) && catalog.slugs_by_plaid[split.secondCategoryId]))) {
        return null;
    }
    const first = (_a = legacy_first_of(str(split.internalDetailedCategory), catalog)) !== null && _a !== void 0 ? _a : legacy_first_of(str(split.internalPrimaryCategory), catalog);
    if (!first)
        return null;
    const plaid_first = (0, split_category_service_1.resolve_split_category)({ plaid_detailed: str(split.plaidDetailedCategory) }, catalog).first_category_id;
    return first !== plaid_first ? first : null;
}
/* eslint-disable @typescript-eslint/naming-convention */
/** A stored user pick the collection no longer knows: kept exactly as stored (as the engine
 *  keeps it — compute_transaction_assignment `keep_stored`); "use auto" still resets it. */
function kept_as_stored(existing, plaid) {
    return {
        plaidPrimaryCategory: plaid.primary,
        plaidDetailedCategory: plaid.detailed,
        categorySource: "user",
        firstCategoryId: str(existing.firstCategoryId),
        overallCategoryId: str(existing.overallCategoryId),
        secondCategoryId: str(existing.secondCategoryId),
        internalPrimaryCategory: null,
        internalDetailedCategory: null,
    };
}
function user_pick(first, second, plaid, catalog) {
    const r = (0, split_category_service_1.resolve_split_category)({
        plaid_detailed: plaid.detailed,
        category_source: "user",
        first_category_id: first,
        second_category_id: second,
    }, catalog);
    return {
        plaidPrimaryCategory: plaid.primary,
        plaidDetailedCategory: plaid.detailed,
        categorySource: "user",
        firstCategoryId: r.first_category_id,
        overallCategoryId: r.overall_category_id,
        secondCategoryId: r.second_category_id,
        internalPrimaryCategory: null,
        internalDetailedCategory: null,
    };
}
function from_plaid(plaid, catalog) {
    const r = (0, split_category_service_1.resolve_split_category)({ plaid_detailed: plaid.detailed }, catalog);
    return {
        plaidPrimaryCategory: plaid.primary,
        plaidDetailedCategory: plaid.detailed,
        categorySource: "plaid",
        firstCategoryId: r.first_category_id,
        overallCategoryId: r.overall_category_id,
        secondCategoryId: null,
        internalPrimaryCategory: null,
        internalDetailedCategory: null,
    };
}
/* eslint-enable @typescript-eslint/naming-convention */
/**
 * @param incoming - The split as the app sent it
 * @param existing - The stored split with the same id (undefined = a new split)
 * @param txn - The stored transaction (its first split's Plaid codes seed a new split)
 */
function resolve_split_category_edit(incoming, existing, txn, catalog) {
    var _a, _b, _c, _d, _e, _f, _g;
    const txn_first = (_b = ((_a = txn.splits) !== null && _a !== void 0 ? _a : [])[0]) !== null && _b !== void 0 ? _b : {};
    const plaid = existing
        ? {
            primary: str(existing.plaidPrimaryCategory),
            detailed: str(existing.plaidDetailedCategory),
        }
        : {
            primary: (_d = (_c = str(incoming.plaidPrimaryCategory)) !== null && _c !== void 0 ? _c : str(txn_first.plaidPrimaryCategory)) !== null && _d !== void 0 ? _d : str(txn.plaidPrimaryCategory),
            detailed: (_f = (_e = str(incoming.plaidDetailedCategory)) !== null && _e !== void 0 ? _e : str(txn_first.plaidDetailedCategory)) !== null && _f !== void 0 ? _f : str(txn.plaidDetailedCategory),
        };
    // The split's category as stored now (a new split: what Plaid gives it).
    const stored_first = (existing === null || existing === void 0 ? void 0 : existing.categorySource) === "user" ? first_of(str(existing.firstCategoryId), catalog) : null;
    const stored_second = str(existing === null || existing === void 0 ? void 0 : existing.secondCategoryId) && catalog.slugs_by_plaid[existing === null || existing === void 0 ? void 0 : existing.secondCategoryId]
        ? existing === null || existing === void 0 ? void 0 : existing.secondCategoryId
        : null;
    const legacy_first = existing ? legacy_override_first(existing, catalog) : null;
    const current = stored_first
        ? user_pick(stored_first, stored_second, plaid, catalog)
        : legacy_first
            ? user_pick(legacy_first, null, plaid, catalog)
            : (existing === null || existing === void 0 ? void 0 : existing.categorySource) === "user"
                ? kept_as_stored(existing, plaid) // a pick we can't read (retired slug) is never dropped
                : from_plaid(plaid, catalog);
    // 1. Explicit pick from the app.
    if (incoming.categorySource === "user") {
        const second = str(incoming.secondCategoryId) && catalog.slugs_by_plaid[incoming.secondCategoryId]
            ? incoming.secondCategoryId
            : null;
        const first = (_g = (second ? first_of(second, catalog) : null)) !== null && _g !== void 0 ? _g : first_of(str(incoming.firstCategoryId), catalog);
        if (first)
            return user_pick(first, second, plaid, catalog);
        // Unknown slug → fall through (never store a category outside the collection).
    }
    else if (incoming.categorySource === "plaid" && (existing === null || existing === void 0 ? void 0 : existing.categorySource) === "user") {
        // "Use auto": the app flipped a STORED user pick back to Plaid. (A legacy override isn't a
        // stored pick yet, so re-sending its "plaid" source keeps it.)
        return from_plaid(plaid, catalog);
    }
    // 2. Older builds: a bare `categoryId`, only when it changed and means a different first.
    const sent = str(incoming.categoryId);
    const stored_sent = existing ? str(existing.categoryId) : null;
    if (sent && sent.toLowerCase() !== "other" && sent !== stored_sent) {
        const first = first_of(sent, catalog);
        if (first && first !== current.firstCategoryId) {
            // A Plaid code sent by an old build is a FIRST pick (canon C8: pick at first).
            return user_pick(first, null, plaid, catalog);
        }
    }
    // 3. Unchanged.
    return current;
}
/**
 * THE raw-split → category-function input mapper (one for every reader: engine, derive, spend,
 * transfer pairing, audit). Reads the canonical fields; an old reclassify that lives only in the
 * legacy `internal*` fields is read as the user's pick (`legacy_override_first`), so the engine
 * and the period page agree even before the one-time backfill rewrites the doc.
 */
function split_category_input_from_raw(split, txn, catalog) {
    var _a;
    const legacy_first = legacy_override_first(split, catalog);
    return {
        plaid_detailed: str(split.plaidDetailedCategory),
        category_source: legacy_first
            ? "user"
            : ((_a = split.categorySource) !== null && _a !== void 0 ? _a : "plaid"),
        first_category_id: legacy_first !== null && legacy_first !== void 0 ? legacy_first : str(split.firstCategoryId),
        overall_category_id: legacy_first ? null : str(split.overallCategoryId),
        second_category_id: legacy_first ? null : str(split.secondCategoryId),
        merchant_name: str(txn.merchantName),
        name: str(txn.name),
    };
}
//# sourceMappingURL=split_category_edit.service.js.map