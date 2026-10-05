"use strict";
/**
 * Merge a Plaid "modified" update into the transaction we already have
 * (Plaid-Modified-Sync-Preserves-Edits).
 *
 * The sync used to write the freshly-built document over the existing one, replacing the
 * whole `splits` array and resetting tags, review flags, categories and the description, so
 * every user edit on that transaction was lost (23,964 rewrites over 6,643 transactions,
 * Aug 15 → Oct 4 2026). This refreshes only what PLAID owns and keeps everything the user (or
 * the app) owns.
 *
 * PURE: no IO. Works on Firestore document shapes (camelCase), since the repository already
 * holds the full existing doc from its batched existence lookup (no extra reads).
 *
 * Ownership (decided 2026-10-05):
 * - Plaid-owned, refreshed: amount, date, names, merchant, vendorKey, Plaid categories, pending
 *   status/ids, account, currency, `isActive`/`isDeleted`; per split: Plaid categories,
 *   source-period ids, paymentDate.
 * - User/app-owned, kept: the splits themselves (ids, count, amounts, descriptions,
 *   Ignore/Refund/Tax, budget + bill pins, tags, rules), `tagIds`, `needsReview`/`needsNote`,
 *   a renamed `description`, the user's category override, `type` (the transfer classifier owns
 *   it), sharing fields, ownership, `initialPlaidData`, `createdAt`.
 * - Amount change: the DEFAULT split absorbs the difference (user decision). If there's no
 *   default split, or it would go negative, splits are rescaled proportionally instead.
 * - Category: a split the user re-categorized (`categorySource: "user"`) keeps its internal
 *   categories; an untouched split takes Plaid's new mapping.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAID_OWNED_SPLIT_FIELDS = exports.PLAID_OWNED_TXN_FIELDS = void 0;
exports.refit_split_amounts = refit_split_amounts;
exports.merge_modified_into_existing = merge_modified_into_existing;
/** Top-level fields Plaid owns: always taken from the fresh document. */
exports.PLAID_OWNED_TXN_FIELDS = [
    "transactionDate",
    "amount",
    "currency",
    "name",
    "merchantName",
    "vendorKey",
    "plaidPrimaryCategory",
    "plaidDetailedCategory",
    "plaidItemId",
    "accountId",
    "isPending",
    "pendingTransactionId",
    "transactionStatus",
    "isActive",
    "isDeleted",
    "updatedAt",
    "updatedBy",
];
/** Per-split fields Plaid (or the date) owns: refreshed on every split. */
exports.PLAID_OWNED_SPLIT_FIELDS = [
    "plaidPrimaryCategory",
    "plaidDetailedCategory",
    "monthlyPeriodId",
    "weeklyPeriodId",
    "biWeeklyPeriodId",
    "paymentDate",
];
/** Per-split fields that hold the category, kept only when the user overrode it. */
const SPLIT_INTERNAL_CATEGORY_FIELDS = [
    "internalPrimaryCategory",
    "internalDetailedCategory",
];
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Re-fit split amounts to a new total (see the header for the rule). */
function refit_split_amounts(splits, new_total) {
    const old_total = round2(splits.reduce((s, sp) => s + num(sp.amount), 0));
    const delta = round2(new_total - old_total);
    if (delta === 0 || splits.length === 0)
        return splits;
    const default_idx = splits.findIndex((sp) => sp.isDefault === true);
    if (default_idx >= 0 && round2(num(splits[default_idx].amount) + delta) >= 0) {
        return splits.map((sp, i) => i === default_idx ? Object.assign(Object.assign({}, sp), { amount: round2(num(sp.amount) + delta) }) : sp);
    }
    // Proportional fallback; the rounding remainder goes to the largest split so totals match.
    if (old_total === 0) {
        const each = round2(new_total / splits.length);
        const out = splits.map((sp) => (Object.assign(Object.assign({}, sp), { amount: each })));
        out[0] = Object.assign(Object.assign({}, out[0]), { amount: round2(new_total - each * (splits.length - 1)) });
        return out;
    }
    const ratio = new_total / old_total;
    const out = splits.map((sp) => (Object.assign(Object.assign({}, sp), { amount: round2(num(sp.amount) * ratio) })));
    const drift = round2(new_total - out.reduce((s, sp) => s + num(sp.amount), 0));
    if (drift !== 0) {
        let largest = 0;
        out.forEach((sp, i) => {
            if (Math.abs(num(sp.amount)) > Math.abs(num(out[largest].amount)))
                largest = i;
        });
        out[largest] = Object.assign(Object.assign({}, out[largest]), { amount: round2(num(out[largest].amount) + drift) });
    }
    return out;
}
/** Returns the document to write for a Plaid "modified" update of an existing transaction. */
function merge_modified_into_existing(existing, fresh) {
    var _a, _b, _c, _d, _e, _f, _g;
    const existing_splits = Array.isArray(existing.splits) ? existing.splits : [];
    const fresh_splits = Array.isArray(fresh.splits) ? fresh.splits : [];
    // Nothing of the user's to keep → the fresh doc as-is (but never drop ownership/sharing).
    if (existing_splits.length === 0) {
        return Object.assign(Object.assign({}, fresh), { createdAt: (_a = existing.createdAt) !== null && _a !== void 0 ? _a : fresh.createdAt });
    }
    const out = Object.assign({}, existing);
    for (const f of exports.PLAID_OWNED_TXN_FIELDS) {
        if (f in fresh)
            out[f] = fresh[f];
    }
    // Description: keep a user rename (description ≠ name on the existing doc), else Plaid's.
    const renamed = typeof existing.description === "string" &&
        existing.description !== "" &&
        existing.description !== existing.name;
    out.description = renamed ? existing.description : (_b = fresh.description) !== null && _b !== void 0 ? _b : existing.description;
    // Top-level internal categories: keep the existing ones (the user's / engine's), fill if empty.
    out.internalPrimaryCategory =
        (_d = (_c = existing.internalPrimaryCategory) !== null && _c !== void 0 ? _c : fresh.internalPrimaryCategory) !== null && _d !== void 0 ? _d : null;
    out.internalDetailedCategory =
        (_f = (_e = existing.internalDetailedCategory) !== null && _e !== void 0 ? _e : fresh.internalDetailedCategory) !== null && _f !== void 0 ? _f : null;
    // Splits: keep the user's splits; refresh Plaid-owned split fields from the fresh primary split.
    const plaid_split = (_g = fresh_splits[0]) !== null && _g !== void 0 ? _g : {};
    let splits = existing_splits.map((sp) => {
        const next = Object.assign({}, sp);
        for (const f of exports.PLAID_OWNED_SPLIT_FIELDS) {
            if (f in plaid_split)
                next[f] = plaid_split[f];
        }
        if (sp.categorySource !== "user") {
            for (const f of SPLIT_INTERNAL_CATEGORY_FIELDS) {
                if (f in plaid_split)
                    next[f] = plaid_split[f];
            }
        }
        if ("updatedAt" in fresh)
            next.updatedAt = fresh.updatedAt;
        return next;
    });
    splits = refit_split_amounts(splits, num(fresh.amount));
    out.splits = splits;
    // Keep the split-derived summaries consistent with the (possibly re-fitted) splits.
    const status = (sp) => (typeof sp.spendStatus === "string" && sp.spendStatus) ||
        (sp.isIgnored === true ? "ignored" : sp.isRefund === true ? "refund" : "counted");
    out.totalAllocated = round2(splits.reduce((s, sp) => s + Math.abs(num(sp.amount)), 0));
    out.isSplit = splits.length > 1;
    if ("returnAmount" in existing || splits.some((sp) => status(sp) === "refund")) {
        out.returnAmount = round2(splits.reduce((s, sp) => s + (status(sp) === "refund" ? Math.abs(num(sp.amount)) : 0), 0));
    }
    return out;
}
//# sourceMappingURL=merge_modified_into_existing.service.js.map