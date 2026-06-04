"use strict";
/**
 * Match Category Domain Service
 *
 * Pure logic resolving a transaction's internal category from category rules:
 * keep an already-meaningful category, else match by merchant (exact, case-
 * insensitive), else by a keyword substring in the transaction name, else the
 * default. The resolver loads the category rules; this picks one.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/match_category
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CATEGORY = void 0;
exports.match_category = match_category;
/** Default category when nothing matches (mirrors the legacy `OTHER_EXPENSE`). */
exports.DEFAULT_CATEGORY = "OTHER_EXPENSE";
/**
 * Resolve a transaction's category.
 *
 * Precedence: an existing non-default category is kept (Plaid already
 * categorised it / a user override is upstream); otherwise merchant match, then
 * keyword match, then the default.
 *
 * PURE FUNCTION.
 */
function match_category(txn, rules) {
    var _a, _b;
    // Already meaningfully categorised → keep it.
    if (txn.plaid_match_category && txn.plaid_match_category !== exports.DEFAULT_CATEGORY) {
        return { category: txn.plaid_match_category, matched_by: "existing" };
    }
    // Merchant match (exact, case-insensitive).
    const merchant = (_a = txn.merchant_name) === null || _a === void 0 ? void 0 : _a.toLowerCase().trim();
    if (merchant) {
        for (const rule of rules) {
            if (rule.merchants.some((m) => m.toLowerCase().trim() === merchant)) {
                return { category: rule.category, matched_by: "merchant" };
            }
        }
    }
    // Keyword match (substring of the transaction name).
    const name = (_b = txn.name) === null || _b === void 0 ? void 0 : _b.toLowerCase();
    if (name) {
        for (const rule of rules) {
            if (rule.keywords.some((k) => k && name.includes(k.toLowerCase()))) {
                return { category: rule.category, matched_by: "keyword" };
            }
        }
    }
    return { category: exports.DEFAULT_CATEGORY, matched_by: "default" };
}
//# sourceMappingURL=match_category.service.js.map