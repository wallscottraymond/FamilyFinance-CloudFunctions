/**
 * A budget's checklist (Manual-Budgets, AF-02): what you plan to buy, with an estimate each. A tick
 * means bought; the budget's spent still comes from its transactions, so nothing here affects any
 * number. The total of the estimates only suggests a budget amount.
 *
 * `carry` is the user's choice per budget. On: the items and estimates carry, and each period has
 * its own ticks. Off: an item belongs to the period it was added in.
 *
 * PURE. @module domain/budgets/budget_checklist
 */
export declare const CHECKLIST_MAX_ITEMS = 100;
/** Older periods' ticks are dropped, so the map stays bounded. */
export declare const CHECKLIST_MAX_TICK_PERIODS = 24;
export interface ChecklistItem {
    id: string;
    name: string;
    estimate: number;
    /** The period it belongs to when not carrying; null when carrying. */
    period_key: string | null;
}
export interface BudgetChecklist {
    carry: boolean;
    items: ChecklistItem[];
    /** Period key → ticked item ids. Keys sort by date (YYYY-MM, or a period id). */
    ticks: Record<string, string[]>;
}
export declare const EMPTY_CHECKLIST: BudgetChecklist;
/** One edit. Single edits, not the whole list, so two people's changes both survive. */
export type ChecklistOp = {
    op: "add";
    id: string;
    name: string;
    estimate: number;
    period_key: string;
} | {
    op: "remove";
    id: string;
} | {
    op: "tick";
    id: string;
    period_key: string;
    ticked: boolean;
} | {
    op: "carry";
    carry: boolean;
    period_key: string;
};
/** The list a new budget starts with, from the items entered while creating it. PURE. */
export declare function compute_initial_checklist(items: Array<{
    id: string;
    name: string;
    estimate: number;
}>): {
    checklist?: BudgetChecklist;
    errors?: string[];
};
/** Apply one edit to the stored list. An edit to an item someone else just removed does nothing. PURE. */
export declare function apply_checklist_op(current: BudgetChecklist, op: ChecklistOp): {
    checklist?: BudgetChecklist;
    errors?: string[];
};
//# sourceMappingURL=budget_checklist.service.d.ts.map