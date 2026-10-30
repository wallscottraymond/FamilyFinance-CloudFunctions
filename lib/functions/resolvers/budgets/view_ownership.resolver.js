"use strict";
/**
 * View ownership inputs (canon A3 — one budget per category PER VIEW): a view's budgets as the
 * claim planner needs them, and what first category each id they store means (slugs and legacy
 * Plaid codes alike), from the module-cached category catalog.
 *
 * @module resolvers/budgets/view_ownership
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_view_ownership = resolve_view_ownership;
const category_catalog_resolver_1 = require("../shared/category_catalog.resolver");
async function resolve_view_ownership(ctx, budgets, extra_category_ids = []) {
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    const first_by_category = {};
    const note = (id) => {
        var _a, _b;
        const first = (_b = (_a = catalog.slugs_by_plaid[id]) === null || _a === void 0 ? void 0 : _a.first_category_id) !== null && _b !== void 0 ? _b : (id in catalog.plaid_by_first ? id : null);
        if (first)
            first_by_category[id] = first;
    };
    for (const b of budgets)
        b.category_ids.forEach(note);
    extra_category_ids.forEach(note);
    return {
        view_budgets: budgets.map((b) => {
            var _a;
            return ({
                id: b.id,
                name: b.name,
                category_ids: (_a = b.category_ids) !== null && _a !== void 0 ? _a : [],
                is_everything_else: b.is_system_everything_else === true,
                start_ms: b.start_date.toMillis(),
            });
        }),
        first_by_category,
    };
}
//# sourceMappingURL=view_ownership.resolver.js.map