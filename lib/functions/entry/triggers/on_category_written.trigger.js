"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_category_written = void 0;
exports.category_mapping_changed = category_mapping_changed;
const firestore_1 = require("firebase-functions/v2/firestore");
const observability_1 = require("../../observability");
const category_repo_1 = require("../../repositories/category.repo");
const reassign_fanout_orchestrator_1 = require("../../orchestrators/transactions/reassign_fanout.orchestrator");
/** The fields that change which category / budget a split resolves to. */
const MAPPING_FIELDS = ["firstCategoryId", "overallCategoryId", "isActive", "merchants", "keywords"];
/** Pure: did this write change the code → category mapping? */
function category_mapping_changed(before, after) {
    if (!before || !after)
        return true; // added or removed
    return MAPPING_FIELDS.some((f) => { var _a, _b; return JSON.stringify((_a = before[f]) !== null && _a !== void 0 ? _a : null) !== JSON.stringify((_b = after[f]) !== null && _b !== void 0 ? _b : null); });
}
exports.on_category_written = (0, firestore_1.onDocumentWritten)({
    document: "categories/{categoryId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const before = (_c = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : null;
    const after = (_f = (_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.data()) !== null && _f !== void 0 ? _f : null;
    (0, category_repo_1.invalidate_category_cache)();
    if (!category_mapping_changed(before, after))
        return;
    const trace_id = (0, observability_1.generate_id)();
    // ONE fan-out per burst of edits (a bulk upload included), delayed past the category cache.
    const scheduled = await (0, reassign_fanout_orchestrator_1.request_category_reassign)({ trace_id, span_id: trace_id });
    console.log(`[${trace_id}] on_category_written: ${event.params.categoryId} mapping changed → ` +
        (scheduled ? "re-assign fan-out scheduled" : "merged into the pending fan-out"));
});
//# sourceMappingURL=on_category_written.trigger.js.map