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
    count_by_user_id(_ctx: TraceContext, user_id: string): Promise<number>;
    /**
     * Finds the user's system "Everything Else" budget, if any.
     */
    find_everything_else(_ctx: TraceContext, user_id: string): Promise<BudgetEntity | null>;
    /**
     * Atomically removes category IDs from a budget's categoryIds array.
     * Idempotent: removing an absent category is a no-op.
     */
    remove_category_ids(ctx: TraceContext, id: string, category_ids: string[], user_id: string): Promise<WriteResult>;
    /**
     * Atomically adds category IDs to a budget's categoryIds array.
     * Idempotent: adding an existing category is a no-op.
     */
    add_category_ids(ctx: TraceContext, id: string, category_ids: string[], user_id: string): Promise<WriteResult>;
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