"use strict";
/**
 * Split Category — THE one way a split's category is decided (Category & Mapping Canon M7).
 *
 * The `categories` collection is a translation layer between Plaid and our budgets (canon §0).
 * Every path that needs a split's category calls `resolve_split_category` with the same catalog:
 * the assignment engine (stored fields), derive-on-read (the period page), sync's in-memory
 * assignment, transfer pairing and the audit. The app does not re-derive — it reads the stored
 * `firstCategoryId` the engine writes from this function.
 *
 *   1. the user's (or a rule's) pick  — `categorySource: "user"` with a first / second slug
 *   2. else the collection's merchant & keyword rules (only when Plaid left it unresolved)
 *   3. else the Plaid detailed code → its collection doc → `firstCategoryId` / `overallCategoryId`
 *   4. else Other (`OTHER_EXPENSE`'s doc) — never null (canon C7)
 *
 * The legacy `internalDetailedCategory` / `internalPrimaryCategory` fields are NOT read (canon M2).
 *
 * PURE: no IO.
 *
 * @module domain/transactions/split_category
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_category_catalog = build_category_catalog;
exports.resolve_split_category = resolve_split_category;
const match_category_service_1 = require("./match_category.service");
function build_category_catalog(docs) {
    var _a, _b, _c, _d;
    const slugs_by_plaid = {};
    const plaid_by_first = {};
    const overall_by_first = {};
    const first_by_name = {};
    const rules = [];
    // Deterministic: first doc (by id) under a first wins as its representative code.
    for (const { id, data } of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
        const first = (_a = data.firstCategoryId) !== null && _a !== void 0 ? _a : null;
        const overall = (_b = data.overallCategoryId) !== null && _b !== void 0 ? _b : null;
        slugs_by_plaid[id] = { overall_category_id: overall, first_category_id: first };
        if (first) {
            if (!(first in plaid_by_first))
                plaid_by_first[first] = id;
            if (!(first in overall_by_first))
                overall_by_first[first] = overall;
            const name = data.first_category;
            const key = typeof name === "string" ? name.trim().toLowerCase() : "";
            if (key && !(key in first_by_name))
                first_by_name[key] = first;
        }
        rules.push({
            category: id,
            merchants: (_c = data.merchants) !== null && _c !== void 0 ? _c : [],
            keywords: (_d = data.keywords) !== null && _d !== void 0 ? _d : [],
        });
    }
    return { slugs_by_plaid, rules, plaid_by_first, overall_by_first, first_by_name };
}
function resolve_split_category(input, catalog) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    // 1. User / rule pick.
    if (input.category_source === "user" && (input.first_category_id || input.second_category_id)) {
        const second = (_a = input.second_category_id) !== null && _a !== void 0 ? _a : null;
        const first = (_d = (_c = (second ? (_b = catalog.slugs_by_plaid[second]) === null || _b === void 0 ? void 0 : _b.first_category_id : null)) !== null && _c !== void 0 ? _c : input.first_category_id) !== null && _d !== void 0 ? _d : null;
        const overall = (_j = (_h = (_f = (second ? (_e = catalog.slugs_by_plaid[second]) === null || _e === void 0 ? void 0 : _e.overall_category_id : null)) !== null && _f !== void 0 ? _f : (first ? (_g = catalog.overall_by_first[first]) !== null && _g !== void 0 ? _g : null : null)) !== null && _h !== void 0 ? _h : input.overall_category_id) !== null && _j !== void 0 ? _j : null;
        const semantic = (_k = second !== null && second !== void 0 ? second : (first ? catalog.plaid_by_first[first] : undefined)) !== null && _k !== void 0 ? _k : match_category_service_1.DEFAULT_CATEGORY;
        return {
            first_category_id: first,
            overall_category_id: overall,
            second_category_id: second,
            category_source: "user",
            semantic_code: semantic,
        };
    }
    // 2–4. Plaid code (upgraded by merchant / keyword rules when unresolved) → collection → Other.
    const resolved = (0, match_category_service_1.match_category)({
        plaid_match_category: (_l = input.plaid_detailed) !== null && _l !== void 0 ? _l : match_category_service_1.DEFAULT_CATEGORY,
        merchant_name: (_m = input.merchant_name) !== null && _m !== void 0 ? _m : null,
        name: (_o = input.name) !== null && _o !== void 0 ? _o : null,
    }, catalog.rules).category;
    const code = catalog.slugs_by_plaid[resolved] ? resolved : match_category_service_1.DEFAULT_CATEGORY;
    const slugs = (_p = catalog.slugs_by_plaid[code]) !== null && _p !== void 0 ? _p : {
        overall_category_id: null,
        first_category_id: null,
    };
    return {
        first_category_id: slugs.first_category_id,
        overall_category_id: slugs.overall_category_id,
        second_category_id: null,
        category_source: "plaid",
        semantic_code: resolved,
    };
}
//# sourceMappingURL=split_category.service.js.map