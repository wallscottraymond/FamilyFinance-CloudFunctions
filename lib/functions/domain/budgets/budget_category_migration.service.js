"use strict";
/**
 * Budget category migration (canon A2, Transaction-Integrity-Review 3c) — PURE.
 *
 * Every budget's `categoryIds` becomes `firstCategoryId` slugs:
 *   - Everything Else → [] (it stores no list — it's the structural fallback);
 *   - a slug stays;
 *   - Plaid detailed codes that cover ALL of a first's codes → that first's slug;
 *   - codes covering only PART of a first → FLAGGED and left as they are (A2: flagged, never
 *     silently widened to the whole first) — the user fixes it in Edit categories;
 *   - an overall slug or an unknown id → flagged, left as is.
 * A real budget whose result is empty is flagged (canon A3b) and not changed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plan_budget_category_migration = plan_budget_category_migration;
function plan_budget_category_migration(budgets, catalog) {
    var _a, _b, _c, _d, _e;
    // first slug → every Plaid code under it
    const codes_by_first = new Map();
    for (const [code, slugs] of Object.entries(catalog.slugs_by_plaid)) {
        if (!slugs.first_category_id)
            continue;
        const set = (_a = codes_by_first.get(slugs.first_category_id)) !== null && _a !== void 0 ? _a : new Set();
        set.add(code);
        codes_by_first.set(slugs.first_category_id, set);
    }
    const overalls = new Set(Object.values(catalog.slugs_by_plaid)
        .map((s) => s.overall_category_id)
        .filter((x) => !!x));
    const changes = [];
    const flags = [];
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    for (const b of budgets) {
        const before = (_b = b.category_ids) !== null && _b !== void 0 ? _b : [];
        if (b.is_everything_else) {
            if (before.length)
                changes.push(Object.assign(Object.assign({}, ids_of(b)), { before, after: [] }));
            continue;
        }
        const after = [];
        const add = (id) => { if (!after.includes(id))
            after.push(id); };
        const codes_by_its_first = new Map();
        for (const id of before) {
            if (id in catalog.plaid_by_first) {
                add(id);
            }
            else if ((_c = catalog.slugs_by_plaid[id]) === null || _c === void 0 ? void 0 : _c.first_category_id) {
                const f = catalog.slugs_by_plaid[id].first_category_id;
                codes_by_its_first.set(f, [...((_d = codes_by_its_first.get(f)) !== null && _d !== void 0 ? _d : []), id]);
            }
            else if (overalls.has(id)) {
                flags.push(Object.assign(Object.assign({}, ids_of(b)), { reason: "overall_slug", ids: [id] }));
                add(id);
            }
            else {
                flags.push(Object.assign(Object.assign({}, ids_of(b)), { reason: "unknown_id", ids: [id] }));
                add(id);
            }
        }
        for (const [first, codes] of codes_by_its_first) {
            const all = (_e = codes_by_first.get(first)) !== null && _e !== void 0 ? _e : new Set();
            if (after.includes(first) || [...all].every((c) => codes.includes(c))) {
                add(first);
            }
            else {
                flags.push(Object.assign(Object.assign({}, ids_of(b)), { reason: "partial_first", ids: codes }));
                codes.forEach(add);
            }
        }
        if (after.length === 0) {
            flags.push(Object.assign(Object.assign({}, ids_of(b)), { reason: "no_categories", ids: [] }));
            continue;
        }
        if (!same(before, after))
            changes.push(Object.assign(Object.assign({}, ids_of(b)), { before, after }));
    }
    return { changes, flags };
}
function ids_of(b) {
    return { budget_id: b.id, owner_key: b.owner_key, name: b.name };
}
//# sourceMappingURL=budget_category_migration.service.js.map