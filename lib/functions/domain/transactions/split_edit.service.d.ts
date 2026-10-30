/**
 * Split edit — what a split edit from the app turns into, before it's written (PURE).
 *
 *   - Each incoming split is MERGED onto the stored split with the same id: the app re-sends the
 *     whole array, and an older build may leave fields out (spendStatus, tags, tax flag, a manual
 *     bill pin, per-lens budgets) — omission must never erase them.
 *   - Fields only the ENGINE sets (per-lens budgets + names + sources, source periods, auto bill /
 *     income links, the legacy budget alias) always come from the STORED split: the app echoes
 *     whatever it last read, which may be older than a re-assign that landed since. From the app
 *     we take only the user's intents — a new budget pin, and status / amount / tags / notes / tax
 *     flag (bill pins go through `assign_split_to_outflow`; a new budget pin takes the split off a
 *     manually pinned bill — canon A4). A new split takes the app's fields
 *     (the engine runs on it).
 *   - Category fields come from the one edit rule (split_category_edit: pick / "use auto" / an old
 *     build's bare categoryId; Plaid codes immutable; `internal*` null).
 *   - Totals + the refund / ignored summaries are recomputed from the final splits.
 *   - `assignment_relevant`: did anything the assignment engine decides on change (split set,
 *     category, amount, budget / bill pins)? A status / note edit doesn't — it only moves spend.
 *   - `category_changed`: a category moved (it can form or break a matched transfer pair).
 *
 * @module domain/transactions/split_edit
 */
import { CategoryCatalog } from "./split_category.service";
type Raw = Record<string, unknown>;
export interface SplitEditResult {
    splits: Raw[];
    totals: {
        isSplit: boolean;
        totalAllocated: number;
        returnAmount: number;
        hasRefundSplits: boolean;
        hasIgnoredSplits: boolean;
    };
    assignment_relevant: boolean;
    category_changed: boolean;
}
export declare function build_split_edit(incoming: Raw[], txn: Raw, catalog: CategoryCatalog, user_id: string, now: unknown, new_id: (index: number) => string): SplitEditResult;
export {};
//# sourceMappingURL=split_edit.service.d.ts.map