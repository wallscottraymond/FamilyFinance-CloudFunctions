/**
 * On Category Written (Trigger) — canon O1: a Plaid code moved to another first category.
 *
 * The `categories` collection is the translation layer (canon §0). When a doc's `firstCategoryId`
 * changes (or a doc is added / (de)activated), every transaction carrying that code may now
 * belong to another budget. Plaid codes live only inside split maps (no query path), so each
 * user gets ONE bounded re-assign run — scheduled by ONE fan-out per burst of edits (a bulk
 * upload of ~100 docs included), delayed past the 5-minute category cache.
 * Cosmetic edits (display names, icons, keywords order…) don't re-assign anything.
 *
 * Per-collection document path (never a wildcard collection segment — see the trigger-cost rule).
 *
 * @module entry/triggers/on_category_written
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { generate_id } from "../../observability";
import { invalidate_category_cache } from "../../repositories/category.repo";
import { request_category_reassign } from "../../orchestrators/transactions/reassign_fanout.orchestrator";

/** The fields that change which category / budget a split resolves to. */
const MAPPING_FIELDS = ["firstCategoryId", "overallCategoryId", "isActive", "merchants", "keywords"];

/** Pure: did this write change the code → category mapping? */
export function category_mapping_changed(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): boolean {
  if (!before || !after) return true; // added or removed
  return MAPPING_FIELDS.some(
    (f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)
  );
}

export const on_category_written = onDocumentWritten(
  {
    document: "categories/{categoryId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null;
    const after = (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null;
    invalidate_category_cache();
    if (!category_mapping_changed(before, after)) return;
    const trace_id = generate_id();
    // ONE fan-out per burst of edits (a bulk upload included), delayed past the category cache.
    const scheduled = await request_category_reassign({ trace_id, span_id: trace_id });
    console.log(
      `[${trace_id}] on_category_written: ${event.params.categoryId} mapping changed → ` +
        (scheduled ? "re-assign fan-out scheduled" : "merged into the pending fan-out")
    );
  }
);
