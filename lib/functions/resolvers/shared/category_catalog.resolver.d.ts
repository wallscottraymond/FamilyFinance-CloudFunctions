/**
 * Category catalog loader — the `categories` collection as the ONE category function needs it
 * (canon M7). Served from the repo's module cache (reference data, one read per instance per TTL),
 * so every derive / engine / sync path gets the same catalog without extra reads.
 *
 * @module resolvers/shared/category_catalog
 */
import { TraceContext } from "../../types";
import { CategoryCatalog } from "../../domain/transactions/split_category.service";
export declare function load_category_catalog(ctx: TraceContext): Promise<CategoryCatalog>;
//# sourceMappingURL=category_catalog.resolver.d.ts.map