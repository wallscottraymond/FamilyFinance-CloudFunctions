/**
 * Budget Repository
 *
 * Handles persistence for budget entities. All writes are audited.
 *
 * NOTE: This repository uses snake_case internally (BudgetEntity) but maps
 * to/from the legacy camelCase Firestore documents (the `Budget` interface in
 * src/types/index.ts) for backwards compatibility.
 *
 * @module repositories/budget
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, ReadOptions, TraceContext } from "../types";
import { BudgetEntity } from "../types/budgets/budget_entity.types";
/**
 * Budget Repository.
 * All write operations automatically create audit entries.
 */
export declare const budget_repo: {
    /**
     * Generates a new budget document ID without writing.
     */
    new_id(): string;
    /**
     * Gets a budget by ID.
     */
    get_by_id(_ctx: TraceContext, id: string, options?: ReadOptions): Promise<BudgetEntity | null>;
    /**
     * Gets all active budgets for a user.
     *
     * Queries by both createdBy (RBAC) and userId (legacy) and dedupes,
     * matching the legacy category-ownership behavior.
     */
    get_by_user_id(_ctx: TraceContext, user_id: string, options?: ReadOptions): Promise<BudgetEntity[]>;
    /**
     * Counts active budgets for a user (used for the budget limit).
     */
    /**
     * Moves a budget to another view (Account-Rooted-Sharing PD6): rewrites the
     * owner key ("uid" or "group:<id>") and who brought it in. `createdBy` is kept.
     */
    set_owner(ctx: TraceContext, budget_id: string, owner_key: string, brought_by: string | null, actor_id: string): Promise<void>;
    count_by_user_id(_ctx: TraceContext, user_id: string): Promise<number>;
    /**
     * Finds the user's system "Everything Else" budget, if any.
     */
    find_everything_else(_ctx: TraceContext, user_id: string, cadence?: "monthly" | "weekly" | "bi_monthly"): Promise<BudgetEntity | null>;
    /**
     * Atomically removes category IDs from a budget's categoryIds array.
     * Idempotent: removing an absent category is a no-op.
     */
    /**
     * Replace a budget's categoryIds only if they still equal `expected` (the one-time A2
     * migration — a budget edited since the reviewed dry run is skipped, never clobbered).
     * @returns false when the budget changed meanwhile.
     */
    replace_category_ids_if_unchanged(_ctx: TraceContext, id: string, expected: string[], next: string[]): Promise<boolean>;
    /** Every active budget (all users + group views) — the one-time A2 migration's input. */
    get_all_active(_ctx: TraceContext): Promise<BudgetEntity[]>;
    remove_category_ids(ctx: TraceContext, id: string, category_ids: string[], user_id: string): Promise<WriteResult>;
    /**
     * Replaces a budget's `tags` with the given (deduped) set. Top-level array so it is directly
     * queryable via array-contains (budget tags, Tag System). Owner check happens in the caller.
     */
    set_tags(ctx: TraceContext, id: string, tag_ids: string[], user_id: string): Promise<void>;
    /**
     * Removes `tag_id` from every budget of the user that carries it. Bounded batch (500-doc
     * commits). Returns the count stripped. Composite index: `budgets(userId, tags array-contains)`.
     */
    strip_tag(_ctx: TraceContext, user_id: string, tag_id: string): Promise<number>;
    /**
     * Writes back period-range metadata after budget periods are generated.
     * Mirrors the legacy `updateBudgetPeriodRange`: sets activePeriodRange +
     * lastExtended for all budgets, and the extension flags for recurring ones.
     */
    set_period_range(ctx: TraceContext, id: string, start_period_id: string, end_period_id: string, generation_end: Timestamp, is_recurring: boolean, user_id: string): Promise<WriteResult>;
    /**
     * Saves a budget (create or update).
     */
    save(ctx: TraceContext, entity: BudgetEntity): Promise<WriteResult>;
    /**
     * Save an EDIT: write only the fields that differ between `before` (the copy the edit was
     * built from) and `after`, as a field-level update. A change another path made in between (a
     * category moved by a transfer, tags, the Everything Else type) is kept, never overwritten
     * with the old copy's value (Code-Health-Review M3-M4).
     */
    save_changes(ctx: TraceContext, before: BudgetEntity, after: BudgetEntity): Promise<WriteResult>;
    /**
     * Updates only the category ownership for a budget (claim/release).
     * Used by the cascade job to transfer categories without a full rewrite.
     */
    set_category_ids(ctx: TraceContext, id: string, category_ids: string[], user_id: string): Promise<WriteResult>;
    /**
     * Hard-deletes a budget document.
     * Matches the legacy delete semantics (the cascade job removes periods and
     * reassigns transaction splits separately).
     */
    hard_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Checks if a budget exists.
     */
    exists(_ctx: TraceContext, id: string): Promise<boolean>;
};
//# sourceMappingURL=budget.repo.d.ts.map