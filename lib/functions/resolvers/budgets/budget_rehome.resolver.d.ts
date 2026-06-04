/**
 * Budget Re-home Resolver
 *
 * READ-ONLY: when a budget gains/loses category ownership (create or update),
 * find the existing transactions whose splits are currently assigned to one of
 * the budgets whose membership changed — i.e. the candidates to re-run through
 * the assignment engine so their spend moves (Everything Else ⇄ the budget).
 *
 * Scoped to the budget's date range (the only range where a split could now
 * match it) via the `transactions(userId, transactionDate)` composite index +
 * an in-memory filter on the split assignment (splits aren't queryable by an
 * inner field).
 *
 * @module resolvers/budgets/budget_rehome
 */
import { TraceContext } from "../../types";
/**
 * Re-home targets after a budget is CREATED: existing transactions on Everything
 * Else within the new budget's range may now match it. Returns [] when there's
 * no EE, or this IS the EE budget (self-provision).
 */
export declare function resolve_created_rehome_transaction_ids(ctx: TraceContext, user_id: string, budget_id: string, ee_hint: string | null, start_ms: number, end_ms: number): Promise<string[]>;
/**
 * Re-home targets after a budget's categories are UPDATED: candidates are the
 * transactions currently on this budget (may release back to EE) or on EE (may
 * gain this budget). Returns [] when no categories changed.
 */
export declare function resolve_updated_rehome_transaction_ids(ctx: TraceContext, user_id: string, budget_id: string, ee_hint: string | null, categories_changed: boolean, start_ms: number, end_ms: number): Promise<string[]>;
/**
 * Resolve the transaction IDs to re-assign after a budget's categories change.
 *
 * @param match_budget_ids - Re-home transactions with a split on ANY of these
 *   (e.g. [everything_else] on create; [everything_else, budget] on update).
 * @param start_ms - Budget coverage window start (inclusive).
 * @param end_ms - Budget coverage window end (inclusive).
 */
export declare function resolve_rehome_transaction_ids(ctx: TraceContext, user_id: string, match_budget_ids: string[], start_ms: number, end_ms: number): Promise<string[]>;
//# sourceMappingURL=budget_rehome.resolver.d.ts.map