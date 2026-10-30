"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.load_category_catalog = load_category_catalog;
const category_repo_1 = require("../../repositories/category.repo");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
let cached = null;
async function load_category_catalog(ctx) {
    const docs = await category_repo_1.category_repo.get_active_cached(ctx);
    // Rebuild only when the cached doc list changes (same array instance = same catalog).
    if (cached && cached.docs === docs)
        return cached.catalog;
    const catalog = (0, split_category_service_1.build_category_catalog)(docs);
    cached = { at: Date.now(), docs, catalog };
    return catalog;
}
//# sourceMappingURL=category_catalog.resolver.js.map