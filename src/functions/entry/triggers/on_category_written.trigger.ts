/**
 * On Category Written (Trigger) — canon O1: a Plaid code moved to another first category.
 *
 * The `categories` collection is the translation layer (canon §0). When a doc's `firstCategoryId`
 * changes (or a doc is added / (de)activated), every transaction carrying that code may now
 * belong to another budget. Plaid codes live only inside split maps (no query path), so each
 * user gets ONE bounded re-assign run (reassign_user — date-ordered pages, written once, one
 * follow-up), DELAYED past the 5-minute category cache so every instance sees the new mapping.
 * Cosmetic edits (display names, icons, keywords order…) don't re-assign anything.
 *
 * Per-collection document path (never a wildcard collection segment — see the trigger-cost rule).
 *
 * @module entry/triggers/on_category_written
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { generate_id } from "../../observability";
import { invalidate_category_cache } from "../../repositories/category.repo";
import { user_repo } from "../../repositories/user.repo";
import { enqueue_reassign_user } from "../../orchestrators/transactions/reassign_user.orchestrator";

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

/** Past the category repo's 5-minute module cache on every instance. */
const DELAY_SECONDS = 6 * 60;

export const on_category_written = onDocumentWritten(
  {
    document: "categories/{categoryId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 120,
  },
  async (event) => {
    const before = (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null;
    const after = (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null;
    invalidate_category_cache();
    if (!category_mapping_changed(before, after)) return;
    const trace_id = generate_id();
    const ctx = { trace_id, span_id: trace_id };
    const user_ids = await user_repo.get_all_ids(ctx);
    let queued = 0;
    for (const user_id of user_ids) {
      // Single-flight per user: several category edits in a row merge into one queued run.
      if (await enqueue_reassign_user({ user_id, reason: "category_collection" }, trace_id, DELAY_SECONDS)) {
        queued++;
      }
    }
    console.log(
      `[${trace_id}] on_category_written: ${event.params.categoryId} mapping changed → ` +
        `${queued}/${user_ids.length} re-assign runs queued`
    );
  }
);
