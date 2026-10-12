/**
 * Category catalog loader — the `categories` collection as the ONE category function needs it
 * (canon M7). Served from the repo's module cache (reference data, one read per instance per TTL),
 * so every derive / engine / sync path gets the same catalog without extra reads.
 *
 * @module resolvers/shared/category_catalog
 */
import { TraceContext } from "../../types";
import { category_repo } from "../../repositories/category.repo";
import {
  build_category_catalog,
  CategoryCatalog,
} from "../../domain/transactions/split_category.service";

let cached: { at: number; docs: unknown; catalog: CategoryCatalog } | null = null;

export async function load_category_catalog(ctx: TraceContext): Promise<CategoryCatalog> {
  const docs = await category_repo.get_active_cached(ctx);
  // Rebuild only when the cached doc list changes (same array instance = same catalog).
  if (cached && cached.docs === docs) return cached.catalog;
  const catalog = build_category_catalog(docs);
  cached = { at: Date.now(), docs, catalog };
  return catalog;
}
