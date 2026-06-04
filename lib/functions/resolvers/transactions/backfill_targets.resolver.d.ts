/**
 * Backfill Targets Resolver
 *
 * READ-ONLY impact analysis for the assignment backfill: enumerates the users
 * to process, and for one user lists the transaction IDs to re-assign and the
 * budget IDs whose spend must be fully recomputed.
 *
 * @module resolvers/transactions/backfill_targets
 */
import { TraceContext } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
/** Per-user work-list for the backfill. */
export interface UserBackfillTargets {
    /** Active transaction doc IDs to re-run assignment on. */
    transaction_ids: string[];
    /**
     * The user's budgets (entities) — needed both to recompute spend and to heal
     * any that are missing their periods (the legacy Everything Else budget).
     */
    budgets: BudgetEntity[];
}
/**
 * Enumerate all user IDs (doc IDs of the `users` collection).
 *
 * Used by the backfill coordinator to fan out one per-user job each.
 */
export declare function resolve_backfill_user_ids(ctx: TraceContext): Promise<string[]>;
/**
 * Resolve one user's backfill work-list: every active transaction (by `userId`,
 * matching the engine) and every budget (real + Everything Else).
 */
export declare function resolve_user_backfill_targets(ctx: TraceContext, user_id: string): Promise<UserBackfillTargets>;
//# sourceMappingURL=backfill_targets.resolver.d.ts.map